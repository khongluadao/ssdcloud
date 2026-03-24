export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        message: "Validation failed",
        issues: result.error.issues.map((item) => ({
          path: item.path.join("."),
          message: item.message,
        })),
      });
    }
    req.body = result.data;
    return next();
  };
}
