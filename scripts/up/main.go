package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	defaultBaseURL = "https://api.ssdcloud.net"
	userAgent      = "ssdcloud-up/1.0"
	envToken       = "SSD_TOKEN"
	envAPIKey      = "SSD_API_KEY"
)

type initiateUploadRequest struct {
	FileName string `json:"fileName"`
	FileSize int64  `json:"fileSize"`
	MimeType string `json:"mimeType"`
}

type initiateUploadResponse struct {
	Upload struct {
		ID        string `json:"id"`
		PartSize  int64  `json:"partSize"`
		TotalPart int    `json:"totalParts"`
	} `json:"upload"`
}

type presignResponse struct {
	URLs map[string]string `json:"urls"`
}

type completeUploadRequest struct {
	Parts []uploadedPart `json:"parts"`
}

type uploadedPart struct {
	PartNumber int    `json:"partNumber"`
	ETag       string `json:"etag"`
}

type completeUploadResponse struct {
	File struct {
		ID string `json:"id"`
	} `json:"file"`
}

type downloadResponse struct {
	URL string `json:"url"`
}

type requestError struct {
	StatusCode int
	URL        string
	Message    string
}

type authKind string

const (
	authKindBearer authKind = "bearer"
	authKindAPIKey authKind = "api_key"
)

type authCredential struct {
	Kind      authKind
	Value     string
	SourceEnv string
}

func (e *requestError) Error() string {
	return fmt.Sprintf("status %d at %s: %s", e.StatusCode, e.URL, e.Message)
}

func main() {
	if len(os.Args) < 2 {
		failf("Usage: up <file-path>")
	}

	filePath := os.Args[1]
	uploadAuth, err := resolveUploadCredential()
	if err != nil {
		failf(
			"No credential found. Set %s (recommended for sk_ API key) or %s.\n"+
				"\n"+
				envSetupHint(authKindAPIKey, "sk_xxx"),
			envAPIKey,
			envToken,
		)
	}

	baseURL := strings.TrimRight(strings.TrimSpace(os.Getenv("SSD_BASE_URL")), "/")
	if baseURL == "" {
		baseURL = defaultBaseURL
	}

	fileInfo, err := os.Stat(filePath)
	if err != nil {
		failf("Cannot read file info: %v", err)
	}
	if fileInfo.IsDir() {
		failf("Path is a directory, expected a file")
	}

	fileName := filepath.Base(filePath)
	mimeType := detectMime(fileName)
	totalSize := fileInfo.Size()

	client := &http.Client{Timeout: 0}

	var initResp initiateUploadResponse
	err = authedJSON(
		client,
		http.MethodPost,
		baseURL+"/api/files/upload/initiate",
		uploadAuth,
		initiateUploadRequest{
			FileName: fileName,
			FileSize: totalSize,
			MimeType: mimeType,
		},
		&initResp,
	)
	if err != nil {
		failUploadStep("Initiate upload failed", err, uploadAuth)
	}

	if initResp.Upload.ID == "" || initResp.Upload.PartSize <= 0 || initResp.Upload.TotalPart <= 0 {
		failf("Invalid initiate response from server")
	}

	file, err := os.Open(filePath)
	if err != nil {
		failf("Cannot open file: %v", err)
	}
	defer file.Close()

	var uploadedBytes int64
	lastPrint := time.Time{}
	parts := make([]uploadedPart, 0, initResp.Upload.TotalPart)

	for partNumber := 1; partNumber <= initResp.Upload.TotalPart; partNumber++ {
		var presignResp presignResponse
		err = authedJSON(
			client,
			http.MethodPost,
			fmt.Sprintf("%s/api/files/upload/%s/presign", baseURL, initResp.Upload.ID),
			uploadAuth,
			map[string][]int{"partNumbers": []int{partNumber}},
			&presignResp,
		)
		if err != nil {
			failUploadStep(fmt.Sprintf("Presign part %d failed", partNumber), err, uploadAuth)
		}

		partURL := presignResp.URLs[fmt.Sprintf("%d", partNumber)]
		if partURL == "" {
			failf("Missing presigned URL for part %d", partNumber)
		}

		partOffset := int64(partNumber-1) * initResp.Upload.PartSize
		partSize := minInt64(initResp.Upload.PartSize, totalSize-partOffset)
		if partSize <= 0 {
			failf("Invalid part size at part %d", partNumber)
		}

		etag, err := putPartWithProgress(client, partURL, io.NewSectionReader(file, partOffset, partSize), partSize, func(sent int64) {
			now := time.Now()
			if now.Sub(lastPrint) < 100*time.Millisecond && sent != partSize {
				return
			}
			lastPrint = now
			current := uploadedBytes + sent
			percent := float64(current) * 100 / float64(totalSize)
			fmt.Printf("\rUpload: %6.2f%%", percent)
		})
		if err != nil {
			failf("Upload part %d failed: %v", partNumber, err)
		}

		uploadedBytes += partSize
		parts = append(parts, uploadedPart{PartNumber: partNumber, ETag: etag})
	}
	fmt.Printf("\rUpload: 100.00%%\n")

	var completeResp completeUploadResponse
	err = authedJSON(
		client,
		http.MethodPost,
		fmt.Sprintf("%s/api/files/upload/%s/complete", baseURL, initResp.Upload.ID),
		uploadAuth,
		completeUploadRequest{Parts: parts},
		&completeResp,
	)
	if err != nil {
		failUploadStep("Complete upload failed", err, uploadAuth)
	}
	if completeResp.File.ID == "" {
		failf("Complete response missing file id")
	}

	if uploadAuth.Kind == authKindAPIKey {
		fmt.Printf("File ID: %s\n", completeResp.File.ID)
		fmt.Println("Upload completed. Download link requires JWT (Authorization).")
		return
	}

	var dlResp downloadResponse
	err = authedJSON(
		client,
		http.MethodGet,
		fmt.Sprintf("%s/api/files/%s/download", baseURL, completeResp.File.ID),
		uploadAuth,
		nil,
		&dlResp,
	)
	if err != nil {
		failUploadStep("Get file link failed", err, uploadAuth)
	}
	if dlResp.URL == "" {
		failf("Download response missing URL")
	}

	fmt.Printf("Link: %s\n", dlResp.URL)
}

func authedJSON(client *http.Client, method, url string, auth authCredential, body any, out any) error {
	var bodyReader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		bodyReader = bytes.NewReader(raw)
	}

	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return err
	}
	applyAuth(req, auth)
	req.Header.Set("User-Agent", userAgent)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(payload))
		if msg == "" {
			msg = "empty error response"
		}
		return &requestError{
			StatusCode: resp.StatusCode,
			URL:        url,
			Message:    msg,
		}
	}

	if out == nil || len(payload) == 0 {
		return nil
	}
	return json.Unmarshal(payload, out)
}

type progressReader struct {
	r       io.Reader
	onRead  func(total int64)
	current int64
}

func (p *progressReader) Read(buf []byte) (int, error) {
	n, err := p.r.Read(buf)
	if n > 0 {
		p.current += int64(n)
		if p.onRead != nil {
			p.onRead(p.current)
		}
	}
	return n, err
}

func putPartWithProgress(client *http.Client, url string, source io.Reader, partSize int64, onProgress func(sent int64)) (string, error) {
	if onProgress != nil {
		onProgress(0)
	}
	reader := &progressReader{r: source, onRead: onProgress}
	req, err := http.NewRequest(http.MethodPut, url, reader)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)
	req.ContentLength = partSize

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}

	etag := resp.Header.Get("etag")
	if etag == "" {
		return "", errors.New("missing etag in storage response")
	}
	if onProgress != nil {
		onProgress(partSize)
	}
	return etag, nil
}

func detectMime(fileName string) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	if ext == "" {
		return "application/octet-stream"
	}
	kind := mime.TypeByExtension(ext)
	if kind == "" {
		return "application/octet-stream"
	}
	return kind
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func failUploadStep(prefix string, err error, auth authCredential) {
	var reqErr *requestError
	if errors.As(err, &reqErr) && (reqErr.StatusCode == http.StatusUnauthorized || reqErr.StatusCode == http.StatusForbidden) {
		if auth.Kind == authKindAPIKey {
			failf(
				"%s: %v\n"+
					"\n"+
					"API key is invalid/revoked or does not have permission.\n"+
					"Set API key again:\n"+
					"\n"+
					envSetupHint(authKindAPIKey, "sk_xxx"),
				prefix,
				err,
			)
		}
		failf(
			"%s: %v\n"+
				"\n"+
				"Token is invalid/expired or does not have permission.\n"+
				"Set token again:\n"+
				"\n"+
				envSetupHint(authKindBearer, "new_jwt_token"),
			prefix,
			err,
		)
	}
	failf("%s: %v", prefix, err)
}

func envSetupHint(kind authKind, tokenPlaceholder string) string {
	execName := filepath.Base(os.Args[0])
	if execName == "" || strings.EqualFold(execName, "main") {
		execName = "up"
	}
	if runtime.GOOS == "windows" {
		if !strings.HasSuffix(strings.ToLower(execName), ".exe") {
			execName += ".exe"
		}
		if kind == authKindAPIKey {
			return fmt.Sprintf(
				"Windows PowerShell:\n  $env:%s=\"%s\"\n  %s .\\file.zip",
				envAPIKey,
				tokenPlaceholder,
				execName,
			)
		}
		return fmt.Sprintf(
			"Windows PowerShell:\n  $env:%s=\"%s\"\n  %s .\\file.zip",
			envToken,
			tokenPlaceholder,
			execName,
		)
	}

	if kind == authKindAPIKey {
		return fmt.Sprintf(
			"Linux/macOS:\n  export %s=\"%s\"\n  %s ./file.zip",
			envAPIKey,
			tokenPlaceholder,
			execName,
		)
	}

	return fmt.Sprintf(
		"Linux/macOS:\n  export %s=\"%s\"\n  %s ./file.zip",
		envToken,
		tokenPlaceholder,
		execName,
	)
}

func resolveUploadCredential() (authCredential, error) {
	apiKey := strings.TrimSpace(os.Getenv(envAPIKey))
	if apiKey != "" {
		return authCredential{Kind: authKindAPIKey, Value: apiKey, SourceEnv: envAPIKey}, nil
	}

	token := strings.TrimSpace(os.Getenv(envToken))
	if token == "" {
		return authCredential{}, errors.New("missing credential env")
	}
	if strings.HasPrefix(token, "sk_") {
		return authCredential{Kind: authKindAPIKey, Value: token, SourceEnv: envToken}, nil
	}

	return authCredential{Kind: authKindBearer, Value: token, SourceEnv: envToken}, nil
}

func applyAuth(req *http.Request, auth authCredential) {
	if auth.Kind == authKindAPIKey {
		req.Header.Set("x-api-key", auth.Value)
		return
	}
	req.Header.Set("Authorization", "Bearer "+auth.Value)
}

func failf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "Error: "+format+"\n", args...)
	os.Exit(1)
}
