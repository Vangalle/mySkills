from __future__ import annotations

import importlib.util
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "obsidian_learning.py"


def load_learner():
    spec = importlib.util.spec_from_file_location("obsidian_learning", MODULE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load obsidian_learning module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DiscoveryAndContextTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.root = self.base / "Documents"
        self.knowledge = self.root / "Knowledge"
        self.work = self.root / "Work"
        for vault in (self.knowledge, self.work):
            (vault / ".obsidian").mkdir(parents=True)

    def tearDown(self):
        self.temporary.cleanup()

    def test_discover_multiple_vaults_and_shared_root(self):
        learner = load_learner()

        result = learner.discover([self.root])

        self.assertEqual(result["roots"], [str(self.root.resolve())])
        self.assertEqual(
            result["vaults"],
            [
                {"name": "Knowledge", "path": str(self.knowledge.resolve())},
                {"name": "Work", "path": str(self.work.resolve())},
            ],
        )

    def test_discover_excludes_the_shared_root_even_when_it_has_obsidian_metadata(self):
        learner = load_learner()
        (self.root / ".obsidian").mkdir()

        result = learner.discover([self.root])

        self.assertEqual(result["roots"], [str(self.root.resolve())])
        self.assertEqual(
            result["vaults"],
            [
                {"name": "Knowledge", "path": str(self.knowledge.resolve())},
                {"name": "Work", "path": str(self.work.resolve())},
            ],
        )

    def test_discover_reports_find_failure_instead_of_partial_success(self):
        learner = load_learner()
        fake_bin = self.base / "bin"
        fake_bin.mkdir()
        find = fake_bin / "find"
        find.write_text("#!/bin/sh\necho 'permission denied' >&2\nexit 1\n", encoding="utf-8")
        find.chmod(0o755)
        grep = fake_bin / "grep"
        grep.write_text("#!/bin/sh\ncat >/dev/null\nexit 1\n", encoding="utf-8")
        grep.chmod(0o755)
        previous_path = os.environ.get("PATH", "")
        os.environ["PATH"] = str(fake_bin)
        try:
            result = learner.discover([self.root])
        finally:
            os.environ["PATH"] = previous_path

        self.assertEqual(result["vaults"], [])
        self.assertEqual(len(result["errors"]), 1)
        self.assertIn("permission denied", result["errors"][0]["error"])

    def test_save_config_records_root_and_vaults(self):
        learner = load_learner()
        config_path = self.base / "config" / "config.json"

        saved = learner.save_config(
            config_path, self.root, [self.knowledge, self.work]
        )

        self.assertEqual(saved["obsidianRoot"], str(self.root.resolve()))
        self.assertEqual(len(saved["vaults"]), 2)
        self.assertEqual(json.loads(config_path.read_text(encoding="utf-8")), saved)

    def test_save_config_rejects_shared_root_as_vault(self):
        learner = load_learner()
        (self.root / ".obsidian").mkdir()

        with self.assertRaisesRegex(ValueError, "root cannot also be a vault"):
            learner.save_config(self.base / "config.json", self.root, [self.root])

    def test_load_config_rejects_shared_root_as_vault(self):
        learner = load_learner()
        (self.root / ".obsidian").mkdir()
        config_path = self.base / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "obsidianRoot": str(self.root),
                    "vaults": [{"name": "Documents", "path": str(self.root)}],
                }
            ),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(ValueError, "root cannot also be a vault"):
            learner.load_config(config_path)

    def test_load_config_reports_and_excludes_stale_vault(self):
        learner = load_learner()
        stale = self.root / "Deleted"
        config_path = self.base / "config.json"
        config_path.write_text(
            json.dumps(
                {
                    "obsidianRoot": str(self.root),
                    "vaults": [
                        {"name": "Knowledge", "path": str(self.knowledge)},
                        {"name": "Deleted", "path": str(stale)},
                    ],
                }
            ),
            encoding="utf-8",
        )

        loaded = learner.load_config(config_path)

        self.assertEqual(
            loaded["vaults"],
            [{"name": "Knowledge", "path": str(self.knowledge.resolve())}],
        )
        self.assertEqual(loaded["staleVaults"], [str(stale.resolve())])

    def test_load_config_rejects_malformed_or_inconsistent_schema(self):
        learner = load_learner()
        outside = self.base / "Outside"
        (outside / ".obsidian").mkdir(parents=True)
        cases = [
            [],
            {"obsidianRoot": 42, "vaults": []},
            {"obsidianRoot": str(self.root), "vaults": "Knowledge"},
            {"obsidianRoot": str(self.base / "Missing"), "vaults": []},
            {
                "obsidianRoot": str(self.root),
                "vaults": [{"name": "Outside", "path": str(outside)}],
            },
        ]

        for index, value in enumerate(cases):
            with self.subTest(index=index):
                config_path = self.base / f"malformed-{index}.json"
                config_path.write_text(json.dumps(value), encoding="utf-8")
                with self.assertRaises(ValueError):
                    learner.load_config(config_path)

    def test_context_inside_vault_skips_selection_and_uses_current_directory(self):
        learner = load_learner()
        nested = self.knowledge / "Topics" / "AI"
        nested.mkdir(parents=True)
        config = learner.save_config(
            self.base / "config.json", self.root, [self.knowledge, self.work]
        )

        result = learner.resolve_context(config, nested)

        self.assertFalse(result["requiresSelection"])
        self.assertEqual(result["activeVault"], str(self.knowledge.resolve()))
        self.assertEqual(result["scope"], str(nested.resolve()))

    def test_context_outside_vault_requires_concrete_selection(self):
        learner = load_learner()
        outside = self.base / "project"
        outside.mkdir()
        config = learner.save_config(
            self.base / "config.json", self.root, [self.knowledge, self.work]
        )

        result = learner.resolve_context(config, outside)

        self.assertTrue(result["requiresSelection"])
        self.assertIsNone(result["activeVault"])
        self.assertEqual(len(result["vaults"]), 2)

    def test_selected_vault_uses_whole_vault_when_cwd_is_outside(self):
        learner = load_learner()
        outside = self.base / "project"
        outside.mkdir()
        config = learner.save_config(
            self.base / "config.json", self.root, [self.knowledge, self.work]
        )

        result = learner.resolve_context(config, outside, self.work)

        self.assertFalse(result["requiresSelection"])
        self.assertEqual(result["activeVault"], str(self.work.resolve()))
        self.assertEqual(result["scope"], str(self.work.resolve()))

    def test_shared_root_is_not_selected_as_a_vault(self):
        learner = load_learner()
        (self.root / ".obsidian").mkdir()
        config = learner.save_config(
            self.base / "config.json", self.root, [self.knowledge, self.work]
        )

        result = learner.resolve_context(config, self.root)

        self.assertTrue(result["requiresSelection"])
        self.assertIsNone(result["activeVault"])


class NoteOperationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.vault = self.base / "vault"
        (self.vault / ".obsidian").mkdir(parents=True)
        self.scope = self.vault / "Topics"
        self.scope.mkdir(parents=True)

    def tearDown(self):
        self.temporary.cleanup()

    def test_eligible_notes_excludes_hidden_directories_and_style_file(self):
        learner = load_learner()
        visible = self.scope / "visible.md"
        visible.write_text("# Visible", encoding="utf-8")
        (self.scope / ".obsidian-learning-style.md").write_text(
            "style", encoding="utf-8"
        )
        hidden = self.scope / ".trash"
        hidden.mkdir()
        (hidden / "deleted.md").write_text("# Deleted", encoding="utf-8")

        result = learner.eligible_notes(self.scope)

        self.assertEqual(result, [visible.resolve()])

    def test_hidden_working_scope_has_no_eligible_notes(self):
        learner = load_learner()
        hidden_scope = self.vault / ".trash" / "nested"
        hidden_scope.mkdir(parents=True)
        note = hidden_scope / "deleted.md"
        note.write_text("# Deleted", encoding="utf-8")

        self.assertEqual(learner.eligible_notes(hidden_scope), [])
        with self.assertRaises(ValueError):
            learner.validate_note(hidden_scope, note)

    def test_sample_does_not_expand_scope_to_reach_ten(self):
        learner = load_learner()
        for index in range(4):
            (self.scope / f"note-{index}.md").write_text(
                f"# Note {index}", encoding="utf-8"
            )
        outside = self.base / "outside.md"
        outside.write_text("# Outside", encoding="utf-8")

        result = learner.sample_notes(self.scope, limit=10, seed=3)

        self.assertEqual(len(result), 4)
        self.assertNotIn(outside.resolve(), result)

    def test_sample_returns_exact_limit_when_more_notes_exist(self):
        learner = load_learner()
        for index in range(12):
            (self.scope / f"note-{index:02}.md").write_text(
                f"# Note {index}", encoding="utf-8"
            )

        first = learner.sample_notes(self.scope, limit=10, seed=7)
        second = learner.sample_notes(self.scope, limit=10, seed=7)

        self.assertEqual(len(first), 10)
        self.assertEqual(first, second)

    def test_search_returns_bounded_fallback_when_nothing_matches(self):
        learner = load_learner()
        for index in range(3):
            (self.scope / f"note-{index}.md").write_text(
                f"# Topic {index}\nUnrelated content.", encoding="utf-8"
            )

        result = learner.search_notes(self.scope, "量子纠缠", limit=2)

        self.assertEqual(len(result), 2)
        self.assertEqual([item["score"] for item in result], [0, 0])

    def test_search_prioritizes_title_match_over_body_match(self):
        learner = load_learner()
        title_match = self.scope / "first.md"
        title_match.write_text("# 梯度下降\n概述。", encoding="utf-8")
        body_match = self.scope / "second.md"
        body_match.write_text("# 机器学习\n这里提到梯度下降。", encoding="utf-8")

        result = learner.search_notes(self.scope, "梯度下降", limit=5)

        self.assertEqual(result[0]["path"], str(title_match.resolve()))
        self.assertGreater(result[0]["score"], result[1]["score"])
        self.assertEqual(result[0]["title"], "梯度下降")

    def test_search_extracts_topic_from_natural_chinese_question(self):
        learner = load_learner()
        target = self.scope / "optimization.md"
        target.write_text("# 梯度下降\n优化算法。", encoding="utf-8")
        other = self.scope / "probability.md"
        other.write_text("# 贝叶斯推断\n概率模型。", encoding="utf-8")

        result = learner.search_notes(self.scope, "请解释梯度下降的基本原理", limit=5)

        self.assertEqual(result[0]["path"], str(target.resolve()))

    def test_search_downweights_chinese_question_boilerplate(self):
        learner = load_learner()
        target = self.scope / "target.md"
        target.write_text("# 梯度下降\n优化算法。", encoding="utf-8")
        for index in range(5):
            (self.scope / f"generic-{index}.md").write_text(
                "# 请解释这个算法的基本原理\n通用说明。", encoding="utf-8"
            )

        result = learner.search_notes(self.scope, "请解释梯度下降的基本原理", limit=5)

        self.assertEqual(result[0]["path"], str(target.resolve()))

    def test_validate_style_accepts_only_exact_non_symlink_vault_file(self):
        learner = load_learner()
        vault = self.base / "vault-with-style"
        (vault / ".obsidian").mkdir(parents=True)
        expected = vault / ".obsidian-learning-style.md"

        self.assertEqual(learner.validate_style(vault), expected.resolve())
        expected.write_text("# Style", encoding="utf-8")
        self.assertEqual(learner.validate_style(vault), expected.resolve())

        expected.unlink()
        outside = self.base / "outside-style.md"
        outside.write_text("# Outside", encoding="utf-8")
        expected.symlink_to(outside)
        with self.assertRaises(ValueError):
            learner.validate_style(vault)

    def test_validate_note_rejects_outside_scope(self):
        learner = load_learner()
        outside = self.base / "outside.md"
        outside.write_text("# Outside", encoding="utf-8")

        with self.assertRaises(ValueError):
            learner.validate_note(self.scope, outside)

    def test_validate_note_rejects_symlink_that_escapes_scope(self):
        learner = load_learner()
        outside = self.base / "outside.md"
        outside.write_text("# Outside", encoding="utf-8")
        link = self.scope / "link.md"
        link.symlink_to(outside)

        with self.assertRaises(ValueError):
            learner.validate_note(self.scope, link)


class SessionModeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_mode_switch_updates_same_session_file(self):
        learner = load_learner()

        first = learner.write_mode("session-42", "direct", self.base)
        second = learner.write_mode("session-42", "notes", self.base)

        expected = self.base / "obsidian-learner" / "session-42" / "mode.json"
        self.assertEqual(first["modeFile"], str(expected))
        self.assertEqual(first["modeFile"], second["modeFile"])
        self.assertEqual(learner.read_mode("session-42", self.base)["mode"], "notes")

    def test_default_mode_path_keeps_public_tmp_prefix(self):
        learner = load_learner()
        session_id = f"obsidian-learning-test-{os.getpid()}"
        expected_directory = Path("/tmp") / "obsidian-learner" / session_id
        try:
            result = learner.write_mode(session_id, "direct")
            self.assertEqual(result["modeFile"], str(expected_directory / "mode.json"))
        finally:
            shutil.rmtree(expected_directory, ignore_errors=True)

    def test_mode_rejects_unsupported_value(self):
        learner = load_learner()

        with self.assertRaises(ValueError):
            learner.write_mode("session-42", "automatic", self.base)

    def test_mode_rejects_session_id_with_path_separators(self):
        learner = load_learner()

        with self.assertRaises(ValueError):
            learner.write_mode("../another-session", "direct", self.base)

    def test_read_mode_rejects_non_object_json(self):
        learner = load_learner()
        mode_file = self.base / "obsidian-learner" / "bad-json" / "mode.json"
        mode_file.parent.mkdir(parents=True)
        mode_file.write_text("[]", encoding="utf-8")

        with self.assertRaises(ValueError):
            learner.read_mode("bad-json", self.base)

    def test_read_mode_fails_when_session_has_no_state(self):
        learner = load_learner()

        with self.assertRaises(ValueError):
            learner.read_mode("missing", self.base)


if __name__ == "__main__":
    unittest.main()
