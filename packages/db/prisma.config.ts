import "dotenv/config";
import { defineConfig } from "prisma/config";

// `prisma generate` never connects to a database, so it must work without
// DIRECT_URL (the migration credential is not set on build hosts). When the
// variable is missing we fall back to a hostname under the reserved .invalid
// TLD, which can never resolve: a migrate without DIRECT_URL fails loudly and
// the error names the missing variable instead of quietly using a wrong DB.
const MISSING_DIRECT_URL = "postgresql://x:x@direct-url-not-set.invalid:5432/postgres";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations"
  },
  datasource: {
    url: process.env.DIRECT_URL || MISSING_DIRECT_URL
  }
});
