import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";

// Project ref is the part after "postgres." in the pooler username.
const projectRef = new URL(process.env.DIRECT_URL).username.split(".")[1];
if (!projectRef) {
  throw new Error("Could not read project ref from DIRECT_URL");
}

const newPassword = crypto.randomBytes(24).toString("hex");

const client = new pg.Client({
  connectionString: process.env.DIRECT_URL,
  ssl: { rejectUnauthorized: false }
});
await client.connect();
await client.query(`ALTER ROLE app_user WITH PASSWORD '${newPassword}';`);
await client.end();

// Direct host: no pooler cache, no project-ref suffix on the username.
const runtimeUrl = `postgresql://app_user:${newPassword}@db.${projectRef}.supabase.co:5432/postgres`;

const envPath = path.resolve(import.meta.dirname, "../../../.env");
let envContent = fs.readFileSync(envPath, "utf-8");

function setEnv(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(content)
    ? content.replace(pattern, line)
    : `${content.trimEnd()}\n${line}\n`;
}

envContent = setEnv(envContent, "APP_USER_PASSWORD", newPassword);
envContent = setEnv(envContent, "RUNTIME_DATABASE_URL", runtimeUrl);
fs.writeFileSync(envPath, envContent);

console.log("app_user password rotated; APP_USER_PASSWORD and RUNTIME_DATABASE_URL written to root .env");
