import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createInterface } from "node:readline/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env.local");
const fields = [
  ["NEXT_PUBLIC_FIREBASE_API_KEY", "apiKey"],
  ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "authDomain"],
  ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", "projectId"],
  ["NEXT_PUBLIC_FIREBASE_APP_ID", "appId"],
];

async function readEnv() {
  try { return await readFile(envPath, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function main() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error("Daylight needs Node.js 22.13 or newer.");
  }
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--check")) {
    throw new Error("Usage: node scripts/setup.mjs [--check]");
  }
  const existing = await readEnv();
  if (args.includes("--check")) {
    const values = { ...parseEnv(existing ?? ""), ...process.env };
    const missing = fields.filter(([key]) => !values[key]?.trim()).map(([key]) => key);
    if (missing.length) throw new Error("Missing configuration: " + missing.join(", "));
    console.log("All four Firebase values are present. Credentials and cloud permissions were not verified.");
    return;
  }
  if (existing !== null) {
    console.log(".env.local already exists and was left unchanged.");
    console.log("Edit it if needed, then run: node scripts/setup.mjs --check");
    return;
  }
  if (!process.stdin.isTTY) {
    throw new Error("Run setup in an interactive terminal, or copy .env.example to .env.local and fill it in.");
  }
  console.log("Daylight setup");
  console.log("First enable Google sign-in and create Firestore with the repository's rules.");
  console.log("Copy these four values from Firebase > Project settings > Your apps.");
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const lines = ["# Firebase Web configuration for your Daylight installation."];
  try {
    for (const [key, label] of fields) {
      let value = "";
      while (!value) {
        value = (await input.question(label + ": ")).trim();
        if (!value) console.log("This value is required.");
        if (value && !/^[A-Za-z0-9:._-]+$/.test(value)) {
          console.log("Paste only the value, without quotes or JavaScript syntax.");
          value = "";
        }
      }
      lines.push(key + "=" + value);
    }
  } finally { input.close(); }
  await writeFile(envPath, lines.join("\n") + "\n", { flag: "wx", mode: 0o600 });
  console.log("Created .env.local. Keep it out of source control.");
  console.log("Next: npm ci, then npm run dev. Open http://localhost:3000 and sign in.");
}

main().catch(error => {
  console.error("Setup: " + error.message);
  process.exitCode = 1;
});
