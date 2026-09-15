from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "obsidian_learning.py"


class CliIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.root = self.base / "Documents"
        self.vault_a = self.root / "Knowledge"
        self.vault_b = self.root / "Work"
        self.scope = self.vault_a / "Topics"
        for vault in (self.vault_a, self.vault_b):
            (vault / ".obsidian").mkdir(parents=True)
        self.scope.mkdir()
        (self.scope / "gradient.md").write_text(
            "# 梯度下降\n核心优化机制。", encoding="utf-8"
        )
        self.config = self.base / "config.json"
        self.temp_root = self.base / "tmp"
        self.temp_root.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def run_cli(self, *arguments: str, expected_code: int = 0) -> tuple[dict, str]:
        result = subprocess.run(
            ["python3", str(SCRIPT), *arguments],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, expected_code, result.stderr)
        stream = result.stdout if expected_code == 0 else result.stderr
        return json.loads(stream), result.stderr

    def test_complete_cli_workflow_returns_json_and_writes_state(self):
        discovered, _ = self.run_cli("discover", "--search-root", str(self.root))
        self.assertEqual(discovered["roots"], [str(self.root.resolve())])
        self.assertEqual(len(discovered["vaults"]), 2)

        saved, _ = self.run_cli(
            "config-save",
            "--config",
            str(self.config),
            "--root",
            str(self.root),
            "--vault",
            str(self.vault_a),
            "--vault",
            str(self.vault_b),
        )
        shown, _ = self.run_cli("config-show", "--config", str(self.config))
        self.assertEqual(saved, shown)

        inside, _ = self.run_cli(
            "context", "--config", str(self.config), "--cwd", str(self.scope)
        )
        self.assertEqual(inside["activeVault"], str(self.vault_a.resolve()))
        outside = self.base / "project"
        outside.mkdir()
        selected, _ = self.run_cli(
            "context",
            "--config",
            str(self.config),
            "--cwd",
            str(outside),
            "--vault",
            str(self.vault_b),
        )
        self.assertEqual(selected["scope"], str(self.vault_b.resolve()))

        sampled, _ = self.run_cli("sample", "--scope", str(self.scope), "--limit", "10")
        self.assertEqual(len(sampled["notes"]), 1)
        searched, _ = self.run_cli(
            "search", "--scope", str(self.scope), "--query", "请解释梯度下降"
        )
        self.assertEqual(searched["candidates"][0]["title"], "梯度下降")

        note = self.scope / "gradient.md"
        validated, _ = self.run_cli(
            "validate-note", "--scope", str(self.scope), "--note", str(note)
        )
        self.assertTrue(validated["valid"])
        style, _ = self.run_cli("validate-style", "--vault", str(self.vault_a))
        self.assertEqual(
            style["styleFile"], str(self.vault_a.resolve() / ".obsidian-learning-style.md")
        )

        set_mode, _ = self.run_cli(
            "mode-set",
            "--session-id",
            "cli-test",
            "--mode",
            "notes",
            "--temp-root",
            str(self.temp_root),
        )
        shown_mode, _ = self.run_cli(
            "mode-show",
            "--session-id",
            "cli-test",
            "--temp-root",
            str(self.temp_root),
        )
        self.assertEqual(set_mode["modeFile"], shown_mode["modeFile"])
        self.assertEqual(shown_mode["mode"], "notes")
        self.assertTrue(Path(shown_mode["modeFile"]).is_file())

    def test_cli_failures_are_nonzero_json_errors(self):
        malformed = self.base / "malformed.json"
        malformed.write_text("[]", encoding="utf-8")
        error, _ = self.run_cli(
            "config-show", "--config", str(malformed), expected_code=2
        )
        self.assertIn("top level must be an object", error["error"])

        outside = self.base / "outside.md"
        outside.write_text("# Outside", encoding="utf-8")
        error, _ = self.run_cli(
            "validate-note",
            "--scope",
            str(self.scope),
            "--note",
            str(outside),
            expected_code=2,
        )
        self.assertIn("outside active scope", error["error"])


if __name__ == "__main__":
    unittest.main()
