// Environment variables set before any module is imported by test files.
process.env["NODE_ENV"] = "test";
process.env["DATABASE_URL"] = "postgresql://test:test@localhost:5432/lumabet_test";
process.env["LUMABET_COIN_FLIP_CONTRACT_ID"] = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD";
process.env["STELLAR_NETWORK"] = "testnet";
process.env["JWT_SECRET"] = "test-jwt-secret-at-least-32-chars-long!";
