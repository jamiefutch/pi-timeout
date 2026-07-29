import { describe, expect, it } from "vitest";
import { classifyCommand } from "../src/classify.ts";

describe("classifyCommand — run commands", () => {
  const run = [
    "./app",
    "./target/release/myapp",
    "/usr/local/bin/tool",
    "../bin/run",
    "./app.exe",
    "dotnet run",
    "dotnet bin/Debug/net8.0/MyApp.dll",
    "dotnet ./out/App.exe",
    "node dist/index.js",
    "bun run dist/app.js",
    "bun app.js",
    "deno run main.ts",
    "cargo run",
    "cargo run --release",
    "go run .",
    "go run cmd/server/main.go",
    "python main.py",
    "python3 app.py",
    "uv run serve.py",
    "java -jar app.jar",
    "java com.example.Main",
    "php index.php",
    "ruby script.rb",
    "npm start",
    "npm run serve",
  ];
  for (const cmd of run) {
    it(`classifies "${cmd}" as run`, () => {
      expect(classifyCommand(cmd)).toBe("run");
    });
  }
});

describe("classifyCommand — npm run scripts are run (can start servers)", () => {
  it("classifies npm run build / dev as run", () => {
    expect(classifyCommand("npm run build")).toBe("run");
    expect(classifyCommand("npm run dev")).toBe("run");
  });
});

describe("classifyCommand — safe tooling", () => {
  const safe = [
    "git status",
    "git commit -m x",
    "ls -la",
    "cat file.txt",
    "grep foo bar.ts",
    "rg pattern",
    "find . -name x",
    "echo hello",
    "mkdir -p out",
    "rm -rf dist",
    "cargo build",
    "cargo test",
    "cargo clippy",
    "dotnet build",
    "dotnet test",
    "go build ./...",
    "go test ./...",
    "make",
    "cmake .",
    "mvn package",
    "gradle build",
    "npm install",
    "npm test",
    "pnpm install",
    "yarn test",
    "pip install requests",
    "brew install fd",
  ];
  for (const cmd of safe) {
    it(`classifies "${cmd}" as safe`, () => {
      expect(classifyCommand(cmd)).toBe("safe");
    });
  }
});

describe("classifyCommand — unknown", () => {
  const unknown = ["sleep 30", "some-unknown-tool --flag", "curl https://x.dev", "python", "node"];
  for (const cmd of unknown) {
    it(`classifies "${cmd}" as unknown`, () => {
      expect(classifyCommand(cmd)).toBe("unknown");
    });
  }
});

describe("classifyCommand — wrappers", () => {
  it("strips sudo", () => {
    expect(classifyCommand("sudo ./app")).toBe("run");
  });
  it("strips nohup", () => {
    expect(classifyCommand("nohup java -jar app.jar")).toBe("run");
  });
  it("strips env VAR=val", () => {
    expect(classifyCommand("env PORT=8080 node dist/index.js")).toBe("run");
  });
  it("strips bare VAR=val prefix", () => {
    expect(classifyCommand("PORT=8080 node dist/index.js")).toBe("run");
  });
  it("strips time", () => {
    expect(classifyCommand("time cargo build")).toBe("safe");
  });
  it("strips command", () => {
    expect(classifyCommand("command ./app")).toBe("run");
  });
  it("strips exec", () => {
    expect(classifyCommand("exec ./app")).toBe("run");
  });
});

describe("classifyCommand — compound chains", () => {
  it("any run segment makes the whole chain run", () => {
    expect(classifyCommand("cargo build && ./target/release/app")).toBe("run");
    expect(classifyCommand("git status && ./app")).toBe("run");
  });
  it("all-safe chain is safe", () => {
    expect(classifyCommand("git add . && git commit -m x")).toBe("safe");
  });
  it("safe + unknown chain is unknown", () => {
    expect(classifyCommand("git status && sleep 5")).toBe("unknown");
  });
  it("handles pipes and semicolons", () => {
    expect(classifyCommand("ls | grep foo")).toBe("safe");
    expect(classifyCommand("make; ./out/app")).toBe("run");
  });
  it("handles the || operator", () => {
    expect(classifyCommand("git status || ./app")).toBe("run");
    expect(classifyCommand("false || git status")).toBe("safe");
  });
  it("empty / whitespace command is unknown", () => {
    expect(classifyCommand("")).toBe("unknown");
    expect(classifyCommand("   ")).toBe("unknown");
  });
});
