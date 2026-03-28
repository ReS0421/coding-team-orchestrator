import { runJudge } from "./commands/judge.js";
import { runValidate } from "./commands/validate.js";
import { runDispatch } from "./commands/dispatch.js";

interface CliResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export function main(args: string[]): CliResult {
  const command = args[0];

  if (!command) {
    return {
      success: false,
      error: "Usage: team-orchestrator <command> [options]\nCommands: judge, validate, dispatch",
    };
  }

  switch (command) {
    case "judge": {
      const jsonInput = args[1];
      if (!jsonInput) {
        return { success: false, error: "judge requires JSON input as second argument" };
      }
      try {
        const input = JSON.parse(jsonInput);
        const result = runJudge(input);
        return { success: true, data: result };
      } catch (e) {
        return { success: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    case "validate": {
      const jsonInput = args[1];
      if (!jsonInput) {
        return { success: false, error: "validate requires JSON input as second argument" };
      }
      try {
        const input = JSON.parse(jsonInput);
        const result = runValidate(input);
        return { success: true, data: result };
      } catch (e) {
        return { success: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    case "dispatch": {
      const jsonInput = args[1];
      if (!jsonInput) {
        return { success: false, error: "dispatch requires JSON input as second argument" };
      }
      try {
        const input = JSON.parse(jsonInput);
        const result = runDispatch(input);
        return { success: true, data: result };
      } catch (e) {
        return { success: false, error: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
    default:
      return { success: false, error: `Unknown command: ${command}` };
  }
}
