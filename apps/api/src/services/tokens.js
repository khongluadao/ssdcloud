import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export function issueAccessToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      roles: user.roles,
    },
    config.jwtAccessSecret,
    { expiresIn: config.accessTokenTtl }
  );
}

export function issueRefreshToken(user) {
  return jwt.sign({ sub: user._id.toString() }, config.jwtRefreshSecret, {
    expiresIn: config.refreshTokenTtl,
  });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwtRefreshSecret);
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtAccessSecret);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
