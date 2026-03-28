#!/usr/bin/env node
import { main } from "./index.js";

const result = main(process.argv.slice(2));

if (result.success) {
  console.log(JSON.stringify(result.data, null, 2));
  process.exit(0);
} else {
  console.error(result.error);
  process.exit(1);
}
