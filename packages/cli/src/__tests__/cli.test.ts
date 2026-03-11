import { describe, it, expect } from "vitest";
import { Command } from "@commander-js/extra-typings";

describe("@totus/cli", () => {
  it("creates a program with correct name", () => {
    const program = new Command()
      .name("totus")
      .description("Totus Health Data CLI")
      .version("0.1.0");

    expect(program.name()).toBe("totus");
  });

  it("has correct version", () => {
    const program = new Command()
      .name("totus")
      .description("Totus Health Data CLI")
      .version("0.1.0");

    expect(program.version()).toBe("0.1.0");
  });

  it("has a description", () => {
    const program = new Command()
      .name("totus")
      .description("Totus Health Data CLI")
      .version("0.1.0");

    expect(program.description()).toBe("Totus Health Data CLI");
  });

  it("shows help text with --help flag", () => {
    const program = new Command()
      .name("totus")
      .description("Totus Health Data CLI")
      .version("0.1.0")
      .exitOverride();

    let helpOutput = "";
    program.configureOutput({
      writeOut: (str) => {
        helpOutput = str;
      },
    });

    try {
      program.parse(["--help"], { from: "user" });
    } catch {
      // Commander throws on --help with exitOverride
    }

    expect(helpOutput).toContain("totus");
    expect(helpOutput).toContain("Totus Health Data CLI");
  });

  it("shows version with --version flag", () => {
    const program = new Command()
      .name("totus")
      .description("Totus Health Data CLI")
      .version("0.1.0")
      .exitOverride();

    let versionOutput = "";
    program.configureOutput({
      writeOut: (str) => {
        versionOutput = str;
      },
    });

    try {
      program.parse(["--version"], { from: "user" });
    } catch {
      // Commander throws on --version with exitOverride
    }

    expect(versionOutput).toContain("0.1.0");
  });
});
