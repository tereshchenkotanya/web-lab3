import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const sslConfig = {
  key: fs.readFileSync(join(__dirname, "localhost-key.pem")),
  cert: fs.readFileSync(join(__dirname, "localhost.pem")),
  minVersion: "TLSv1.2",
  maxVersion: "TLSv1.2",
  ciphers: "AES256-SHA256:AES256-SHA",
};
