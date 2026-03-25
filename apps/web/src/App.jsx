import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { apiFetch, getUploadQuote, multipartUpload } from "./api";
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Progress } from "./components/ui/progress";

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

function useAuth() {
  const [token, setToken] = useState(localStorage.getItem("accessToken") || "");
  const [user, setUser] = useState(null);

  const isAuthenticated = useMemo(() => Boolean(token), [token]);

  const saveToken = (nextToken) => {
    setToken(nextToken);
    localStorage.setItem("accessToken", nextToken);
  };

  const clearToken = () => {
    setToken("");
    setUser(null);
    localStorage.removeItem("accessToken");
  };

  const fetchMe = async (providedToken = token) => {
    if (!providedToken) return null;
    const me = await apiFetch("/api/me", {
      headers: { Authorization: `Bearer ${providedToken}` },
    });
    setUser(me);
    return me;
  };

  const refreshAccessToken = async () => {
    const data = await apiFetch("/api/auth/refresh", { method: "POST" });
    saveToken(data.accessToken);
    await fetchMe(data.accessToken);
  };

  useEffect(() => {
    if (!token) return;
    fetchMe().catch(async () => {
      try {
        await refreshAccessToken();
      } catch {
        clearToken();
      }
    });
  }, []);

  return {
    token,
    user,
    isAuthenticated,
    saveToken,
    clearToken,
    fetchMe,
    refreshAccessToken,
  };
}

function Landing() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>SSDCloud</CardTitle>
          <CardDescription>Upload file cloud storage with token-based script upload.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button asChild>
            <Link to="/login">Login</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/register">Register</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Register({ auth }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      const data = await apiFetch("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      auth.saveToken(data.accessToken);
      await auth.fetchMe(data.accessToken);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle>Register</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="register-email">Email</Label>
              <Input
                id="register-email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="register-password">Password</Label>
              <Input
                id="register-password"
                type="password"
                placeholder="Password (min 8 chars)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full">
              Create Account
            </Button>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Register failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Login({ auth }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError("");
    try {
      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      auth.saveToken(data.accessToken);
      await auth.fetchMe(data.accessToken);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle>Login</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="login-email">Email</Label>
              <Input id="login-email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">Password</Label>
              <Input
                id="login-password"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full">
              Login
            </Button>
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Login failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Dashboard({ auth }) {
  const [files, setFiles] = useState([]);
  const [keys, setKeys] = useState([]);
  const [error, setError] = useState("");
  const [newKeyName, setNewKeyName] = useState("");
  const [lastPlaintextKey, setLastPlaintextKey] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [topupAmount, setTopupAmount] = useState(1000);
  const [isUploading, setIsUploading] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadController, setUploadController] = useState(null);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteData, setQuoteData] = useState(null);

  function currentAccessToken() {
    return localStorage.getItem("accessToken") || auth.token;
  }

  async function authedFetch(path, options = {}, canRetry = true) {
    try {
      return await apiFetch(path, {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${currentAccessToken()}`,
        },
      });
    } catch (err) {
      if (canRetry && err?.message === "Invalid token") {
        await auth.refreshAccessToken();
        return authedFetch(path, options, false);
      }
      throw err;
    }
  }

  async function ensureAuthenticated() {
    try {
      await auth.fetchMe(currentAccessToken());
    } catch (err) {
      if (err?.message === "Invalid token") {
        await auth.refreshAccessToken();
        return;
      }
      throw err;
    }
  }

  async function loadData() {
    try {
      setError("");
      await ensureAuthenticated();
      const [fileData, keyData] = await Promise.all([authedFetch("/api/files"), authedFetch("/api/keys")]);
      setFiles(fileData);
      setKeys(keyData);
    } catch (err) {
      if (err?.message === "Invalid refresh token" || err?.message === "Missing refresh token") {
        auth.clearToken();
      }
      setError(err.message);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function createKey() {
    try {
      const data = await authedFetch("/api/keys", {
        method: "POST",
        body: JSON.stringify({ name: newKeyName }),
      });
      setNewKeyName("");
      setLastPlaintextKey(data.plaintextKey);
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function revokeKey(id) {
    try {
      await authedFetch(`/api/keys/${id}`, { method: "DELETE" });
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function requestUploadQuote() {
    if (!selectedFile || isUploading || isQuoting) return;
    try {
      setError("");
      setIsQuoting(true);
      const quote = await getUploadQuote({ file: selectedFile, token: auth.token });
      setQuoteData(quote);
      setQuoteOpen(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsQuoting(false);
    }
  }

  async function confirmUpload() {
    if (!selectedFile || !quoteData || isUploading) return;
    const controller = new AbortController();

    try {
      setError("");
      setIsUploading(true);
      setUploadController(controller);
      setUploadProgress(0);

      await multipartUpload({
        file: selectedFile,
        token: auth.token,
        signal: controller.signal,
        onProgress: (uploaded, total) => {
          const percent = Math.floor((uploaded / Math.max(total, 1)) * 100);
          setUploadProgress(Math.min(100, percent));
        },
      });

      setQuoteOpen(false);
      setQuoteData(null);
      setSelectedFile(null);
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setIsUploading(false);
      setUploadController(null);
    }
  }

  function cancelUpload() {
    if (uploadController) {
      uploadController.abort();
    }
  }

  async function deleteFile(id) {
    try {
      await authedFetch(`/api/files/${id}`, { method: "DELETE" });
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  async function downloadFile(id) {
    try {
      const data = await authedFetch(`/api/files/${id}/download`);
      window.open(data.url, "_blank");
    } catch (err) {
      setError(err.message);
    }
  }

  async function logout() {
    try {
      await authedFetch("/api/auth/logout", { method: "POST" });
    } finally {
      auth.clearToken();
    }
  }

  async function topupBalance() {
    try {
      await authedFetch("/api/me/topup", {
        method: "POST",
        body: JSON.stringify({ amount: Number(topupAmount) }),
      });
      await loadData();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Dashboard</CardTitle>
            <CardDescription>Email: {auth.user?.email || "-"}</CardDescription>
          </div>
          <Button variant="secondary" onClick={logout}>
            Logout
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Balance: {auth.user?.balance ?? 0}</p>
          <div className="flex gap-3">
            <Input
              type="number"
              min={1}
              value={topupAmount}
              onChange={(e) => setTopupAmount(e.target.value)}
            />
            <Button onClick={topupBalance}>Topup (demo)</Button>
          </div>
          {error && (
            <Alert variant="destructive">
              <AlertTitle>Action failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upload file</CardTitle>
          <CardDescription>Get server quote and confirm cost before upload starts.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            type="file"
            disabled={isUploading || isQuoting}
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
          />
          {selectedFile && (
            <p className="text-sm text-muted-foreground">
              {selectedFile.name} ({formatBytes(selectedFile.size)}) - Mode:{" "}
              Multipart
            </p>
          )}
          {isUploading && (
            <div className="space-y-2">
              <Progress value={uploadProgress} />
              <p className="text-sm text-muted-foreground">Uploading... {uploadProgress}%</p>
            </div>
          )}
          <div className="flex gap-3">
            <Button onClick={requestUploadQuote} disabled={!selectedFile || isUploading || isQuoting}>
              {isQuoting ? "Getting quote..." : "Upload"}
            </Button>
            {isUploading && (
              <Button variant="secondary" onClick={cancelUpload}>
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {files.length === 0 && <p className="text-sm text-muted-foreground">No files yet.</p>}
          {files.map((file) => (
            <div key={file.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="flex-1 text-sm">
                {file.originalName} ({formatBytes(file.sizeBytes)}) - Charged: {file.costCharged}
              </div>
              <Button size="sm" variant="secondary" onClick={() => downloadFile(file.id)}>
                Download
              </Button>
              <Button size="sm" variant="outline" onClick={() => deleteFile(file.id)}>
                Delete
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Key name (ex: my-script)"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
          />
          <Button onClick={createKey}>Create key</Button>
          {lastPlaintextKey && (
            <Alert>
              <AlertTitle>Copy this key now (shown once)</AlertTitle>
              <AlertDescription className="break-all">{lastPlaintextKey}</AlertDescription>
            </Alert>
          )}
          {keys.map((key) => (
            <div key={key.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="flex-1 text-sm">
                {key.name} - {key.keyPrefix}... {key.revokedAt ? "(revoked)" : ""}
              </div>
              {!key.revokedAt && (
                <Button size="sm" variant="outline" onClick={() => revokeKey(key.id)}>
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={quoteOpen} onOpenChange={setQuoteOpen}>
        <DialogContent
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Confirm upload cost</DialogTitle>
            <DialogDescription>
              Review the server quote before starting upload. Charge is applied when upload begins.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 text-sm">
            <p>
              <strong>File:</strong> {selectedFile?.name || "-"}
            </p>
            <p>
              <strong>Size:</strong> {selectedFile ? formatBytes(selectedFile.size) : "-"}
            </p>
            <p>
              <strong>Mode:</strong> {quoteData?.deliveryMode || "-"}
            </p>
            <p>
              <strong>Cost:</strong> {quoteData?.cost ?? 0}
            </p>
            <p>
              <strong>Balance after upload:</strong> {quoteData?.balanceAfter ?? "-"}
            </p>
          </div>

          {quoteData?.insufficient && (
            <Alert variant="destructive">
              <AlertTitle>Insufficient balance</AlertTitle>
              <AlertDescription>Please top up before confirming upload.</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setQuoteOpen(false)} disabled={isUploading}>
              Cancel
            </Button>
            <Button onClick={confirmUpload} disabled={quoteData?.insufficient || isUploading}>
              {isUploading ? "Uploading..." : "Confirm and upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProtectedRoute({ auth, children }) {
  if (!auth.isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  const auth = useAuth();

  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/register" element={<Register auth={auth} />} />
      <Route path="/login" element={<Login auth={auth} />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute auth={auth}>
            <Dashboard auth={auth} />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
