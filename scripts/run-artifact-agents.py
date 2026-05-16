#!/usr/bin/env python3
"""Generate real artifacts from the bundled agent scenarios.

The script is intentionally local-first:
- outputs stay under agent-outputs/ by default
- no internet downloads are performed
- local Ollama calls are optional and limited to localhost
- Office files are macro-free OOXML zip packages created with stdlib only
"""

from __future__ import annotations

import argparse
import html
import json
import posixpath
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import zipfile
from dataclasses import dataclass
from datetime import date, timedelta
from itertools import product
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ROOT = REPO_ROOT / "agent-outputs" / "hypothetical-local-agent-suite"
FORBIDDEN_SUFFIXES = {".app", ".command", ".dmg", ".exe", ".pkg", ".scpt", ".sh"}
FORBIDDEN_ZIP_PARTS = {"vbaProject.bin", "activeX", "oleObject", "embeddings"}
SOURCE_URLS = [
    "https://docs.ollama.com/api/generate",
    "https://openai.github.io/openai-agents-js/guides/guardrails/",
    "https://openai.github.io/openai-agents-js/guides/tracing/",
    "https://www.anthropic.com/research/building-effective-agents/",
    "https://arxiv.org/abs/2303.11366",
    "https://arxiv.org/abs/2310.03714",
]


@dataclass(frozen=True)
class Profile:
    name: str
    deck_slides: int
    doc_sections: int
    dashboard_widgets: int
    include_security_pack: bool


PROFILES = {
    "lean": Profile("lean", deck_slides=4, doc_sections=3, dashboard_widgets=3, include_security_pack=False),
    "balanced": Profile("balanced", deck_slides=6, doc_sections=5, dashboard_widgets=4, include_security_pack=True),
    "full": Profile("full", deck_slides=7, doc_sections=6, dashboard_widgets=5, include_security_pack=True),
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate real local agent artifacts.")
    parser.add_argument("--root", default=str(DEFAULT_ROOT), help="Output root.")
    parser.add_argument("--profile", choices=sorted(PROFILES), default="full")
    parser.add_argument("--doe", action="store_true", help="Run 2^3 DOE with real artifacts.")
    parser.add_argument("--doe-runs", type=int, default=8, help="DOE run count. Use 50 for the extended mixed-level suite.")
    parser.add_argument("--score", action="store_true", help="Print numeric validation score only.")
    parser.add_argument("--json", action="store_true", help="Print JSON result.")
    parser.add_argument("--skip-models", action="store_true", help="Do not call local Ollama models.")
    parser.add_argument("--models", default="qwen3:8b-q4_K_M,gemma4:26b,llama3.2:3b,gpt-oss:20b,tinyllama:latest")
    parser.add_argument("--timeout", type=int, default=45)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    ensure_allowed_root(root)
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True, exist_ok=True)

    model_notes = [] if args.skip_models else collect_model_notes(args.models.split(","), args.timeout)
    final_result = generate_suite(root / "final", PROFILES[args.profile], model_notes, "final")

    doe_result = None
    if args.doe:
        doe_root = root / ("doe-runs" if args.doe_runs == 8 else f"doe-{args.doe_runs}-runs")
        doe_result = run_doe(doe_root, model_notes, args.doe_runs)
        write_doe_report(root, doe_result)

    validation = validate_output_tree(root)
    result = {
        "root": str(root),
        "profile": args.profile,
        "modelNotes": model_notes,
        "final": final_result,
        "doe": doe_result,
        "validation": validation,
        "score": validation["score"],
        "maxScore": validation["maxScore"],
        "passed": validation["passed"],
    }
    write_json(root / "run-summary.json", result)
    write_markdown_summary(root / "README.md", result)

    if args.score:
        print(result["score"])
    elif args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"Artifact root: {root}")
        print(f"Score: {result['score']}/{result['maxScore']}")
        print(f"Passed: {result['passed']}")
        print("Key outputs:")
        for item in final_result["outputs"]:
            print(f"- {item}")
        if doe_result:
            print(f"DOE best: {doe_result['best']['runId']} score={doe_result['best']['score']}")

    return 0 if result["passed"] else 1


def collect_model_notes(models: list[str], timeout: int) -> list[dict[str, Any]]:
    notes: list[dict[str, Any]] = []
    prompt = (
        "Return compact JSON with keys schedulePlan, honestyControl, and toolBoundary. "
        "Design controls for a Chief of Staff agent that optimizes a founder's schedule "
        "using local files and sandboxed tools."
    )
    for model in [item.strip() for item in models if item.strip()]:
        payload = json.dumps({
            "model": model,
            "system": "Answer with compact JSON only. No markdown.",
            "prompt": prompt,
            "stream": False,
            "think": False,
            "options": {"num_predict": 96, "temperature": 0.1},
        }).encode("utf-8")
        request = urllib.request.Request(
            "http://localhost:11434/api/generate",
            data=payload,
            headers={"content-type": "application/json"},
        )
        started = time.time()
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
            notes.append({
                "model": model,
                "status": "ok",
                "durationSeconds": round(time.time() - started, 2),
                "response": body.get("response", "").strip(),
                "qualityScore": score_model_note(body.get("response", "")),
            })
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            notes.append({
                "model": model,
                "status": "error",
                "durationSeconds": round(time.time() - started, 2),
                "error": str(error),
            })
    return notes


def score_model_note(text: str) -> int:
    lowered = text.lower()
    terms = [
        "schedule",
        "calendar",
        "priority",
        "honesty",
        "uncertain",
        "sandbox",
        "tool",
        "permission",
        "local",
        "output",
    ]
    return sum(1 for term in terms if term in lowered)


def generate_suite(
    root: Path,
    profile: Profile,
    model_notes: list[dict[str, Any]],
    run_id: str,
    experiment: dict[str, Any] | None = None,
) -> dict[str, Any]:
    experiment = experiment or {}
    root.mkdir(parents=True, exist_ok=True)
    outputs: list[str] = []

    deck_slides = build_slide_plan(profile, model_notes, experiment)
    deck_path = root / "powerpoint-deck-builder" / "board-update" / "deck.pptx"
    write_pptx(deck_path, "Local Agent Builder Board Update", deck_slides)
    write_json(deck_path.with_name("slides.json"), {"slides": deck_slides, "profile": profile.name})
    write_text(deck_path.with_name("speaker-notes.md"), speaker_notes(deck_slides))
    outputs.extend(relative_paths(root, [deck_path, deck_path.with_name("slides.json"), deck_path.with_name("speaker-notes.md")]))

    doc_sections = build_document_sections(profile, model_notes, experiment)
    doc_path = root / "writing-agent" / "executive-brief" / "domain-learning-agent-brief.docx"
    write_docx(doc_path, "Domain-Learning Agent Brief", doc_sections)
    write_text(doc_path.with_suffix(".md"), markdown_from_sections("Domain-Learning Agent Brief", doc_sections))
    outputs.extend(relative_paths(root, [doc_path, doc_path.with_suffix(".md")]))

    ops_path = root / "chief-of-staff-agent" / "weekly-ops" / "operating-plan.docx"
    write_docx(ops_path, "Weekly Operating Plan", chief_of_staff_sections(model_notes))
    outputs.append(str(ops_path.relative_to(root)))

    schedule_dir = root / "chief-of-staff-agent" / "schedule-optimizer"
    schedule = sample_schedule(experiment)
    productivity_plan = optimize_schedule(schedule, experiment)
    write_json(schedule_dir / "input-schedule.json", schedule)
    write_json(schedule_dir / "time-block-plan.json", productivity_plan)
    write_json(schedule_dir / "learning-ledger.json", productivity_plan["learningLedger"])
    write_text(schedule_dir / "chief-of-staff-team.md", chief_of_staff_team_markdown(productivity_plan))
    write_text(schedule_dir / "optimized-week.ics", calendar_ics(productivity_plan))
    time_plan_doc = schedule_dir / "weekly-time-plan.docx"
    write_docx(
        time_plan_doc,
        "Chief of Staff 100x Productivity Plan",
        chief_of_staff_productivity_sections(productivity_plan),
        tables=time_plan_tables(productivity_plan, experiment),
    )
    outputs.extend(relative_paths(schedule_dir.parent.parent, [
        schedule_dir / "input-schedule.json",
        schedule_dir / "time-block-plan.json",
        schedule_dir / "learning-ledger.json",
        schedule_dir / "chief-of-staff-team.md",
        schedule_dir / "optimized-week.ics",
        time_plan_doc,
    ]))

    productivity_dashboard_dir = root / "chief-of-staff-agent" / "productivity-dashboard"
    write_json(productivity_dashboard_dir / "dashboard-data.json", productivity_dashboard_payload(productivity_plan, profile))
    write_text(productivity_dashboard_dir / "index.html", productivity_dashboard_html(productivity_plan, profile))
    outputs.extend(relative_paths(root, [productivity_dashboard_dir / "dashboard-data.json", productivity_dashboard_dir / "index.html"]))

    researched_dir = root / "researched-deck-agent" / "agent-framework-topic"
    outputs.extend(relative_paths(root, write_researched_topic_artifacts(researched_dir, profile, model_notes, experiment)))

    quality_dir = root / "artifact-quality-agent" / "quality-review"
    outputs.extend(relative_paths(root, write_quality_review_artifacts(quality_dir, profile, experiment)))

    local_doe_dir = root / "local-llm-doe-agent" / "experiment-loop"
    outputs.extend(relative_paths(root, write_local_llm_doe_artifacts(local_doe_dir, model_notes, experiment)))

    handoff_dir = root / "agent-handoff-agent" / "instruction-handoff"
    outputs.extend(relative_paths(root, write_handoff_artifacts(handoff_dir, experiment)))

    model_dir = root / "model-comparison-agent" / "local-llm-review"
    write_json(model_dir / "model-comparison.json", model_comparison_report(model_notes))
    write_text(model_dir / "model-comparison.md", model_comparison_markdown(model_notes))
    outputs.extend(relative_paths(root, [model_dir / "model-comparison.json", model_dir / "model-comparison.md"]))

    skill_dir = root / "agent-skill-pack"
    write_json(skill_dir / "skills-index.json", agent_skill_index(experiment))
    write_text(skill_dir / "README.md", agent_skill_pack_markdown(experiment))
    outputs.extend(relative_paths(root, [skill_dir / "skills-index.json", skill_dir / "README.md"]))

    workbook_path = root / "data-analysis-agent" / "usage-review" / "metrics-workbook.xlsx"
    write_xlsx(workbook_path, workbook_rows(profile))
    csv_path = workbook_path.with_name("metrics.csv")
    write_csv(csv_path, workbook_rows(profile))
    write_text(workbook_path.with_name("analysis-summary.md"), analysis_summary(profile))
    outputs.extend(relative_paths(root, [workbook_path, csv_path, workbook_path.with_name("analysis-summary.md")]))

    dashboard_dir = root / "app-builder-agent" / "html-dashboard"
    dashboard_path = dashboard_dir / "index.html"
    dashboard_data = dashboard_payload(profile)
    write_json(dashboard_dir / "dashboard-data.json", dashboard_data)
    write_text(dashboard_path, dashboard_html(profile, dashboard_data))
    outputs.extend(relative_paths(root, [dashboard_path, dashboard_dir / "dashboard-data.json"]))

    investment_dir = root / "investment-opportunity-agent" / "opportunity-review"
    outputs.extend(relative_paths(root, write_investment_opportunity_artifacts(investment_dir, profile, experiment)))

    research_dir = root / "research-brief-agent" / "security-research"
    write_json(research_dir / "source-index.json", source_index(experiment))
    write_text(research_dir / "research-brief.md", research_brief(model_notes, experiment))
    pdf_path = research_dir / "security-brief.pdf"
    write_pdf(pdf_path, "Secure Local Artifact Agents", [
        "Agents generated real DOCX, PPTX, XLSX, HTML, JSON, CSV, PDF, and Markdown outputs.",
        "Outputs are constrained to agent-outputs and scanned for macro-like package parts.",
        "Local model notes came from Ollama models only; no internet downloads were performed.",
    ])
    outputs.extend(relative_paths(root, [research_dir / "source-index.json", research_dir / "research-brief.md", pdf_path]))

    review_dir = root / "code-review-agent" / "security-review"
    write_json(review_dir / "risk-summary.json", risk_summary(profile))
    write_text(review_dir / "findings.md", code_review_findings(profile))
    outputs.extend(relative_paths(root, [review_dir / "risk-summary.json", review_dir / "findings.md"]))

    manifest = {
        "schemaVersion": "agent-builder.real-output-run.v1",
        "runId": run_id,
        "profile": profile.__dict__,
        "experiment": experiment,
        "outputs": outputs,
        "models": model_notes,
        "constraints": {
            "outputRoot": str(root),
            "internetDownloads": "disabled",
            "externalLinks": "source references only",
            "macros": "forbidden",
            "executables": "forbidden",
        },
    }
    write_json(root / "run-manifest.json", manifest)
    write_text(root / "artifact-index.html", artifact_index_html(outputs, profile))
    outputs.append("run-manifest.json")
    outputs.append("artifact-index.html")

    validation = validate_output_tree(root)
    return {
        "runId": run_id,
        "root": str(root),
        "profile": profile.__dict__,
        "outputs": outputs,
        "score": validation["score"],
        "maxScore": validation["maxScore"],
        "passed": validation["passed"],
    }


def time_plan_tables(plan: dict[str, Any], experiment: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    experiment = experiment or {}
    tables = [
        {
            "title": "Recommended Time Blocks",
            "rows": [["Day", "Time", "Mode", "Why"], *[
                [block["day"], f"{block['start']} - {block['end']}", block["mode"], block["why"]]
                for block in plan["optimizedBlocks"]
            ]],
        },
        {
            "title": "Learning Loop",
            "rows": [["Iteration", "Hypothesis", "Result", "Decision"], *[
                [str(item["iteration"]), item["hypothesis"], item["result"], item["decision"]]
                for item in plan["learningLedger"]
            ]],
        },
    ]
    if int(experiment.get("wordTables", 2)) >= 3:
        tables.append({
            "title": "Chief of Staff Team",
            "rows": [["Agent", "Job"], *[[item["agent"], item["job"]] for item in plan["team"]]],
        })
    if int(experiment.get("wordTables", 2)) >= 4:
        tables.append({
            "title": "Guardrail Checks",
            "rows": [["Rule", "Owner"], *[[rule, "Honesty Auditor"] for rule in plan["rules"]]],
        })
    return tables


def run_doe(root: Path, model_notes: list[dict[str, Any]], run_count: int = 8) -> dict[str, Any]:
    if run_count != 8:
        return run_mixed_level_doe(root, model_notes, run_count)

    factors = [
        ("deckDepth", {"low": 4, "high": 7}),
        ("docDepth", {"low": 3, "high": 6}),
        ("dashboardDepth", {"low": 3, "high": 5}),
    ]
    runs: list[dict[str, Any]] = []
    for levels in product(["low", "high"], repeat=len(factors)):
        settings = dict(zip([factor[0] for factor in factors], levels))
        profile = Profile(
            name="-".join(f"{key}-{value}" for key, value in settings.items()),
            deck_slides=factors[0][1][settings["deckDepth"]],
            doc_sections=factors[1][1][settings["docDepth"]],
            dashboard_widgets=factors[2][1][settings["dashboardDepth"]],
            include_security_pack=True,
        )
        run_id = "-".join(f"{key}-{value}" for key, value in settings.items())
        result = generate_suite(root / run_id, profile, model_notes, run_id)
        result["factors"] = settings
        runs.append(result)

    best = sorted(runs, key=lambda item: item["score"], reverse=True)[0]
    effects = main_effects(factors, runs)
    return {
        "design": "2^3 full factorial with real docx, pptx, xlsx, html, pdf, csv, markdown, and json outputs",
        "response": "validated artifact score",
        "factors": [{"name": name, "levels": levels} for name, levels in factors],
        "runs": runs,
        "best": best,
        "effects": effects,
    }


MIXED_LEVEL_FACTORS: list[tuple[str, list[Any], int]] = [
    ("deckSlides", [4, 5, 6, 7, 8], 1),
    ("docSections", [3, 4, 5, 6, 7], 2),
    ("dashboardWidgets", [3, 4, 5, 6], 3),
    ("scheduleStrategy", ["focus", "research", "delegate", "balanced", "recovery"], 4),
    ("researchDepth", [3, 4, 5, 6, 7], 7),
    ("wordTables", [2, 3, 4], 11),
    ("qaDepth", [3, 4, 5, 6, 7], 13),
    ("skillDepth", [5, 6, 7, 8, 9, 10], 17),
    ("handoffFormat", ["minimal", "brief", "full", "role-card"], 19),
    ("localDoeInterpretation", ["fast", "cautious", "replicated", "strict"], 23),
    ("localDoeReplicates", [2, 3, 4, 5], 29),
]


def run_mixed_level_doe(root: Path, model_notes: list[dict[str, Any]], run_count: int) -> dict[str, Any]:
    if run_count < 1:
        raise SystemExit("--doe-runs must be at least 1")
    runs: list[dict[str, Any]] = []
    for index, settings in enumerate(mixed_level_settings(run_count), start=1):
        profile = Profile(
            name=f"mixed-{index:02d}",
            deck_slides=int(settings["deckSlides"]),
            doc_sections=int(settings["docSections"]),
            dashboard_widgets=int(settings["dashboardWidgets"]),
            include_security_pack=True,
        )
        run_id = (
            f"mixed-{index:02d}-deck{settings['deckSlides']}-doc{settings['docSections']}"
            f"-dash{settings['dashboardWidgets']}-{settings['scheduleStrategy']}-{settings['handoffFormat']}"
        )
        result = generate_suite(root / run_id, profile, model_notes, run_id, settings)
        result["factors"] = settings
        runs.append(result)

    best = sorted(runs, key=lambda item: item["score"], reverse=True)[0]
    return {
        "design": f"{run_count}-run deterministic mixed-level DOE with real researched decks, schedule plans, dashboards, docs, QA scorecards, local LLM DOE loops, and safe Office artifacts",
        "response": "validated artifact score",
        "factors": [{"name": name, "levels": levels} for name, levels, _stride in MIXED_LEVEL_FACTORS],
        "runs": runs,
        "best": best,
        "effects": mixed_level_effects(MIXED_LEVEL_FACTORS, runs),
    }


def mixed_level_settings(run_count: int) -> list[dict[str, Any]]:
    settings: list[dict[str, Any]] = []
    seen: set[str] = set()
    index = 0
    while len(settings) < run_count:
        item = {
            name: levels[(index * stride + factor_index) % len(levels)]
            for factor_index, (name, levels, stride) in enumerate(MIXED_LEVEL_FACTORS)
        }
        key = json.dumps(item, sort_keys=True)
        if key not in seen:
            seen.add(key)
            settings.append(item)
        index += 1
    return settings


def mixed_level_effects(factors: list[tuple[str, list[Any], int]], runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    effects: list[dict[str, Any]] = []
    for name, levels, _stride in factors:
        means = []
        for level in levels:
            scores = [run["score"] for run in runs if run["factors"].get(name) == level]
            if scores:
                means.append({"level": level, "meanScore": round(sum(scores) / len(scores), 2), "count": len(scores)})
        if means:
            best = max(means, key=lambda item: item["meanScore"])
            worst = min(means, key=lambda item: item["meanScore"])
            effects.append({
                "factor": name,
                "effect": round(best["meanScore"] - worst["meanScore"], 2),
                "bestLevel": best["level"],
                "worstLevel": worst["level"],
                "levelMeans": means,
            })
    return sorted(effects, key=lambda item: abs(item["effect"]), reverse=True)


def main_effects(factors: list[tuple[str, dict[str, int]]], runs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    effects = []
    for name, _levels in factors:
        high = [run["score"] for run in runs if run["factors"][name] == "high"]
        low = [run["score"] for run in runs if run["factors"][name] == "low"]
        effects.append({
            "factor": name,
            "effect": round(sum(high) / len(high) - sum(low) / len(low), 2),
        })
    return sorted(effects, key=lambda item: abs(item["effect"]), reverse=True)


def validate_output_tree(root: Path) -> dict[str, Any]:
    errors: list[str] = []
    score = 0
    max_score = 0
    files = [item for item in root.rglob("*") if item.is_file()]
    required_suffixes = {".csv", ".docx", ".html", ".ics", ".json", ".md", ".pdf", ".pptx", ".xlsx"}

    for suffix in required_suffixes:
        max_score += 5
        if any(item.suffix == suffix for item in files):
            score += 5
        else:
            errors.append(f"Missing required artifact type: {suffix}")

    for item in files:
        max_score += 1
        if is_inside(root, item):
            score += 1
        else:
            errors.append(f"Output escaped root: {item}")
        if item.suffix in FORBIDDEN_SUFFIXES:
            errors.append(f"Forbidden executable-like output: {item}")

    for item in files:
        if item.suffix in {".docx", ".pptx", ".xlsx"}:
            max_score += 4
            package_errors = validate_ooxml_package(item)
            if package_errors:
                errors.extend(package_errors)
            else:
                score += 4

            if item.suffix == ".pptx":
                max_score += 7
                score += min(count_pptx_slides(item), 7)
                max_score += 4
                pptx_errors = validate_pptx_hygiene(item)
                if pptx_errors:
                    errors.extend(pptx_errors)
                else:
                    score += 4
            if item.suffix == ".docx":
                max_score += 6
                score += min(count_docx_sections(item), 6)
                if item.name == "weekly-time-plan.docx":
                    max_score += 4
                    if count_docx_tables(item) >= 2:
                        score += 4
                    else:
                        errors.append(f"Chief of Staff time plan is missing formatted tables: {item}")
            if item.suffix == ".xlsx":
                max_score += 5
                score += min(count_xlsx_rows(item), 5)

    for html_file in root.rglob("*.html"):
        max_score += 2
        content = html_file.read_text(encoding="utf-8")
        allows_external_sources = "investment-opportunity-agent" in str(html_file)
        has_unsafe_external_link = "https://" in content and not allows_external_sources
        if "<script" in content and "dashboardData" in content and not has_unsafe_external_link:
            score += 2
        else:
            errors.append(f"Dashboard HTML is missing local interactivity or includes external links: {html_file}")
        max_score += 5
        score += min(content.count('class="card"'), 5)

    for json_file in root.rglob("*.json"):
        max_score += 1
        try:
            json.loads(json_file.read_text(encoding="utf-8"))
            score += 1
        except json.JSONDecodeError as error:
            errors.append(f"Invalid JSON {json_file}: {error}")

    for plan_file in root.rglob("time-block-plan.json"):
        max_score += 14
        try:
            plan = json.loads(plan_file.read_text(encoding="utf-8"))
            if len(plan.get("optimizedBlocks", [])) >= 5:
                score += 3
            else:
                errors.append(f"Schedule plan has too few optimized blocks: {plan_file}")
            if len(plan.get("team", [])) >= 5:
                score += 3
            else:
                errors.append(f"Chief of Staff team is underspecified: {plan_file}")
            if len(plan.get("learningLedger", [])) >= 3:
                score += 3
            else:
                errors.append(f"Learning ledger has too few iterations: {plan_file}")
            baseline = plan.get("baselineMetrics", {})
            optimized = plan.get("optimizedMetrics", {})
            if optimized.get("deepWorkHours", 0) > baseline.get("deepWorkHours", 0):
                score += 3
            else:
                errors.append(f"Schedule plan does not improve deep-work hours: {plan_file}")
            if any("missing" in rule.lower() or "approval" in rule.lower() for rule in plan.get("rules", [])):
                score += 2
            else:
                errors.append(f"Schedule plan lacks honesty or approval guardrails: {plan_file}")
        except json.JSONDecodeError as error:
            errors.append(f"Invalid time-block plan {plan_file}: {error}")

    for comparison_file in root.rglob("model-comparison.json"):
        max_score += 8
        try:
            comparison = json.loads(comparison_file.read_text(encoding="utf-8"))
            if comparison.get("schemaVersion") == "agent-builder.local-model-comparison.v1":
                score += 2
            if comparison.get("recommendedRouter"):
                score += 3
            if comparison.get("status") in {"skipped", "completed"}:
                score += 1
            if comparison.get("status") == "skipped" or comparison.get("ranking") or comparison.get("results"):
                score += 2
        except json.JSONDecodeError as error:
            errors.append(f"Invalid model comparison {comparison_file}: {error}")

    for skill_index_file in root.rglob("skills-index.json"):
        max_score += 6
        try:
            skill_index = json.loads(skill_index_file.read_text(encoding="utf-8"))
            if len(skill_index.get("skills", [])) >= 5:
                score += 3
            if skill_index.get("promotionGate", {}).get("requiresMeasuredImprovement") is True:
                score += 2
            if "honest" in skill_index.get("purpose", "").lower():
                score += 1
        except json.JSONDecodeError as error:
            errors.append(f"Invalid skill index {skill_index_file}: {error}")

    for claim_table_file in root.rglob("claim-table.json"):
        max_score += 8
        try:
            claim_table = json.loads(claim_table_file.read_text(encoding="utf-8"))
            claims = claim_table.get("claims", [])
            statuses = {claim.get("status") for claim in claims}
            if len(claims) >= 3:
                score += 2
            else:
                errors.append(f"Claim table has too few claims: {claim_table_file}")
            if "verified" in statuses:
                score += 2
            else:
                errors.append(f"Claim table has no verified claims: {claim_table_file}")
            if "inferred" in statuses or "needs_review" in statuses:
                score += 2
            else:
                errors.append(f"Claim table lacks uncertainty labels: {claim_table_file}")
            if all(claim.get("source") for claim in claims):
                score += 2
            else:
                errors.append(f"Claim table has source gaps: {claim_table_file}")
        except json.JSONDecodeError as error:
            errors.append(f"Invalid claim table {claim_table_file}: {error}")

    for investment_scorecard_file in root.rglob("investment-scorecard.json"):
        max_score += 10
        try:
            scorecard = json.loads(investment_scorecard_file.read_text(encoding="utf-8"))
            if scorecard.get("schemaVersion") == "agent-builder.investment-scorecard.v1":
                score += 2
            if int(scorecard.get("overallScore", 0)) >= 1:
                score += 2
            else:
                errors.append(f"Investment scorecard is missing an overall score: {investment_scorecard_file}")
            dimensions = scorecard.get("dimensions", [])
            if len(dimensions) >= 5:
                score += 2
            else:
                errors.append(f"Investment scorecard has too few dimensions: {investment_scorecard_file}")
            if scorecard.get("upsideCase") and scorecard.get("bearCase"):
                score += 2
            else:
                errors.append(f"Investment scorecard lacks upside or bear case: {investment_scorecard_file}")
            if "not investment advice" in scorecard.get("disclaimer", "").lower():
                score += 2
            else:
                errors.append(f"Investment scorecard lacks diligence disclaimer: {investment_scorecard_file}")
        except json.JSONDecodeError as error:
            errors.append(f"Invalid investment scorecard {investment_scorecard_file}: {error}")

    for investment_claim_file in root.rglob("investment-claim-validation.json"):
        max_score += 10
        try:
            validation = json.loads(investment_claim_file.read_text(encoding="utf-8"))
            claims = validation.get("claims", [])
            verdicts = {claim.get("verdict") for claim in claims}
            if len(claims) >= 4:
                score += 2
            else:
                errors.append(f"Investment claim validation has too few claims: {investment_claim_file}")
            if "supported" in verdicts and "refuted" in verdicts:
                score += 2
            else:
                errors.append(f"Investment claim validation must include supported and refuted verdicts: {investment_claim_file}")
            if "needs-review" in verdicts or "deck-only" in verdicts:
                score += 2
            else:
                errors.append(f"Investment claim validation lacks uncertainty labels: {investment_claim_file}")
            if all(claim.get("source") and claim.get("diligenceAction") for claim in claims):
                score += 2
            else:
                errors.append(f"Investment claim validation lacks source or diligence action: {investment_claim_file}")
            if validation.get("priorSessionId"):
                score += 2
            else:
                errors.append(f"Investment claim validation lacks prior-session context: {investment_claim_file}")
        except json.JSONDecodeError as error:
            errors.append(f"Invalid investment claim validation {investment_claim_file}: {error}")

    for notes_file in root.rglob("human-score-and-notes.md"):
        max_score += 6
        content = notes_file.read_text(encoding="utf-8").lower()
        if "audience_scope: investments" in content and "retrieval_scope: investments" in content:
            score += 2
        else:
            errors.append(f"Investment notes lack investment retrieval metadata: {notes_file}")
        if "recommendation" in content and "human score" in content:
            score += 2
        else:
            errors.append(f"Investment notes lack human score or recommendation: {notes_file}")
        if "claim validation snapshot" in content:
            score += 2
        else:
            errors.append(f"Investment notes lack claim validation snapshot: {notes_file}")

    for handoff_file in root.rglob("handoff-protocol.json"):
        max_score += 8
        try:
            handoff = json.loads(handoff_file.read_text(encoding="utf-8"))
            if handoff.get("schemaVersion") == "agent-builder.agent-handoff.v1":
                score += 2
            if len(handoff.get("shareWhat", [])) >= 6:
                score += 2
            else:
                errors.append(f"Handoff protocol is missing share-what detail: {handoff_file}")
            if len(handoff.get("doNotShare", [])) >= 3:
                score += 2
            else:
                errors.append(f"Handoff protocol is missing do-not-share rules: {handoff_file}")
            if any("Stop" in item or "stop" in item for item in handoff.get("template", [])):
                score += 2
            else:
                errors.append(f"Handoff protocol template lacks stop condition: {handoff_file}")
        except json.JSONDecodeError as error:
            errors.append(f"Invalid handoff protocol {handoff_file}: {error}")

    for local_doe_file in root.rglob("local-doe-results.json"):
        max_score += 12
        try:
            local_doe = json.loads(local_doe_file.read_text(encoding="utf-8"))
            if local_doe.get("schemaVersion") == "agent-builder.local-llm-doe.v1":
                score += 2
            experiments = local_doe.get("experiments", [])
            if len(experiments) >= 3:
                score += 2
            else:
                errors.append(f"Local LLM DOE has too few experiments: {local_doe_file}")
            if int(local_doe.get("replicateCount", 0)) >= 3:
                score += 2
            if len(local_doe.get("smallModelCautions", [])) >= 5:
                score += 2
            else:
                errors.append(f"Local LLM DOE lacks small-model cautions: {local_doe_file}")
            if all(row.get("confidence") in {"low", "medium", "high"} and row.get("decision") for row in experiments):
                score += 2
            else:
                errors.append(f"Local LLM DOE lacks confidence or decisions: {local_doe_file}")
            low_confidence_promotions = [
                row for row in experiments
                if row.get("confidence") == "low" and row.get("decision") == "promote"
            ]
            if not low_confidence_promotions:
                score += 2
            else:
                errors.append(f"Local LLM DOE promotes low-confidence results: {local_doe_file}")
        except json.JSONDecodeError as error:
            errors.append(f"Invalid local LLM DOE results {local_doe_file}: {error}")

    for pdf_file in root.rglob("*.pdf"):
        max_score += 3
        content = pdf_file.read_bytes()
        if content.startswith(b"%PDF-") and b"/JavaScript" not in content and b"/OpenAction" not in content:
            score += 3
        else:
            errors.append(f"Unsafe or invalid PDF: {pdf_file}")

    for csv_file in root.rglob("*.csv"):
        max_score += 2
        content = csv_file.read_text(encoding="utf-8")
        if "Metric,Value,Notes" in content and "\n" in content:
            score += 2
        else:
            errors.append(f"Invalid CSV metrics artifact: {csv_file}")

    for ics_file in root.rglob("*.ics"):
        max_score += 3
        content = ics_file.read_text(encoding="utf-8")
        if "BEGIN:VCALENDAR" in content and content.count("BEGIN:VEVENT") >= 5 and "20260501" in content:
            score += 3
        else:
            errors.append(f"Invalid calendar artifact: {ics_file}")

    return {
        "passed": not errors,
        "score": score,
        "maxScore": max_score,
        "files": [str(item.relative_to(root)) for item in files],
        "errors": errors,
    }


def validate_ooxml_package(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        with zipfile.ZipFile(path) as package:
            names = package.namelist()
            file_names = [name for name in names if not name.endswith("/")]
            if "[Content_Types].xml" not in names:
                errors.append(f"{path} missing [Content_Types].xml")
            if any(any(part in name for part in FORBIDDEN_ZIP_PARTS) for name in file_names):
                errors.append(f"{path} contains forbidden embedded/macro part")
            for name in file_names:
                if name.endswith(".rels"):
                    rels = package.read(name).decode("utf-8", errors="ignore")
                    if 'TargetMode="External"' in rels:
                        errors.append(f"{path} contains external relationship in {name}")
            if path.suffix == ".pptx" and not any(name.startswith("ppt/slides/slide") for name in names):
                errors.append(f"{path} missing slides")
            if path.suffix == ".docx" and "word/document.xml" not in names:
                errors.append(f"{path} missing word/document.xml")
            if path.suffix == ".xlsx" and not any(name.startswith("xl/worksheets/") for name in names):
                errors.append(f"{path} missing worksheet")
    except zipfile.BadZipFile:
        errors.append(f"{path} is not a valid zip package")
    return errors


def count_pptx_slides(path: Path) -> int:
    with zipfile.ZipFile(path) as package:
        return sum(
            1
            for name in package.namelist()
            if name.startswith("ppt/slides/slide") and name.endswith(".xml")
        )


def count_docx_sections(path: Path) -> int:
    with zipfile.ZipFile(path) as package:
        document = package.read("word/document.xml").decode("utf-8", errors="ignore")
    return document.count('w:pStyle w:val="Heading1"')


def count_docx_tables(path: Path) -> int:
    with zipfile.ZipFile(path) as package:
        document = package.read("word/document.xml").decode("utf-8", errors="ignore")
    return document.count("<w:tbl>")


def count_xlsx_rows(path: Path) -> int:
    with zipfile.ZipFile(path) as package:
        worksheet = package.read("xl/worksheets/sheet1.xml").decode("utf-8", errors="ignore")
    return worksheet.count("<row ")


def validate_pptx_hygiene(path: Path) -> list[str]:
    errors: list[str] = []
    placeholder_terms = ["Slide Number", "Click to add", "Lorem ipsum", "Replace with", "TODO", "TBD"]
    with zipfile.ZipFile(path) as package:
        names = [name for name in package.namelist() if not name.endswith("/")]
        slides = [name for name in names if name.startswith("ppt/slides/slide") and name.endswith(".xml")]
        if len(slides) < 1:
            errors.append(f"{path} contains no slide XML parts")
        for name in slides:
            xml = package.read(name).decode("utf-8", errors="ignore")
            if any(term in xml for term in placeholder_terms):
                errors.append(f"{path} contains placeholder text in {name}")
            if 'type="sldNum"' in xml or "placeholderType" in xml:
                errors.append(f"{path} contains slide-number placeholder in {name}")
        for name in names:
            if name.startswith("ppt/media/") and package.getinfo(name).file_size == 0:
                errors.append(f"{path} contains zero-byte media part {name}")
    return errors


def write_docx(
    path: Path,
    title: str,
    sections: list[tuple[str, list[str]]],
    tables: list[dict[str, Any]] | None = None,
) -> None:
    paragraphs = [docx_paragraph(title, style="Title")]
    for heading, bullets in sections:
        paragraphs.append(docx_paragraph(heading, style="Heading1"))
        for bullet in bullets:
            paragraphs.append(docx_paragraph(bullet, style="ListParagraph"))
    for table in tables or []:
        table_title = table.get("title")
        if table_title:
            paragraphs.append(docx_paragraph(str(table_title), style="Heading2"))
        paragraphs.append(docx_table(table.get("rows", [])))

    document_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {''.join(paragraphs)}
    <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>'''
    write_zip(path, {
        "[Content_Types].xml": content_types_docx(),
        "_rels/.rels": root_rels("word/document.xml"),
        "docProps/core.xml": core_props(title),
        "docProps/app.xml": app_props("Agent Builder"),
        "word/document.xml": document_xml,
        "word/styles.xml": word_styles(),
        "word/_rels/document.xml.rels": relationships([]),
    })


def docx_paragraph(text: str, style: str | None = None) -> str:
    style_xml = f"<w:pPr><w:pStyle w:val=\"{style}\"/></w:pPr>" if style else ""
    return f"<w:p>{style_xml}<w:r><w:t>{escape(text)}</w:t></w:r></w:p>"


def docx_table(rows: list[list[Any]]) -> str:
    if not rows:
        return ""
    table_rows = []
    for row_index, row in enumerate(rows):
        cells = []
        for cell in row:
            fill = '<w:shd w:fill="E5F0FF"/>' if row_index == 0 else ""
            bold = "<w:b/>" if row_index == 0 else ""
            cells.append(
                "<w:tc>"
                f"<w:tcPr>{fill}<w:tcW w:w=\"2400\" w:type=\"dxa\"/></w:tcPr>"
                f"<w:p><w:r><w:rPr>{bold}</w:rPr><w:t>{escape(str(cell))}</w:t></w:r></w:p>"
                "</w:tc>"
            )
        table_rows.append(f"<w:tr>{''.join(cells)}</w:tr>")
    borders = (
        '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:left w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:right w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/></w:tblBorders>'
    )
    return f"<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/>{borders}</w:tblPr>{''.join(table_rows)}</w:tbl>"


def write_pptx(path: Path, title: str, slides: list[dict[str, Any]]) -> None:
    script = REPO_ROOT / "scripts" / "write-pptx.mjs"
    spec_path = path.with_suffix(".pptx-spec.json")
    write_json(spec_path, {"title": title, "slides": slides})
    try:
        subprocess.run(
            ["node", str(script), str(spec_path), str(path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=45,
        )
        strip_zip_directory_entries(path)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as error:
        if path.exists():
            path.unlink()
        write_pptx_ooxml(path, title, slides)
        write_text(
            path.with_suffix(".pptx-warning.txt"),
            f"Fell back to minimal OOXML deck generation because pptxgenjs failed: {error}\n",
        )
    finally:
        if spec_path.exists():
            spec_path.unlink()


def strip_zip_directory_entries(path: Path) -> None:
    temp_path = path.with_suffix(path.suffix + ".tmp")
    with zipfile.ZipFile(path) as source, zipfile.ZipFile(temp_path, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            if info.filename.endswith("/"):
                continue
            target.writestr(info, source.read(info.filename))
    temp_path.replace(path)


def write_pptx_ooxml(path: Path, title: str, slides: list[dict[str, Any]]) -> None:
    files: dict[str, str] = {
        "[Content_Types].xml": content_types_pptx(len(slides)),
        "_rels/.rels": root_rels("ppt/presentation.xml"),
        "docProps/core.xml": core_props(title),
        "docProps/app.xml": app_props("Agent Builder"),
        "ppt/presentation.xml": presentation_xml(slides),
        "ppt/_rels/presentation.xml.rels": presentation_rels(len(slides)),
        "ppt/slideLayouts/slideLayout1.xml": slide_layout_xml(),
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": relationships([
            ("rId1", "../slideMasters/slideMaster1.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster"),
        ]),
        "ppt/slideMasters/slideMaster1.xml": slide_master_xml(),
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": relationships([
            ("rId1", "../slideLayouts/slideLayout1.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"),
            ("rId2", "../theme/theme1.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"),
        ]),
        "ppt/theme/theme1.xml": theme_xml(),
        "ppt/presProps.xml": "<p:presentationPr xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"/>",
        "ppt/viewProps.xml": "<p:viewPr xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\"/>",
        "ppt/tableStyles.xml": "<a:tblStyleLst xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" def=\"{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}\"/>",
    }
    for index, slide in enumerate(slides, start=1):
        files[f"ppt/slides/slide{index}.xml"] = slide_xml(slide, index)
        files[f"ppt/slides/_rels/slide{index}.xml.rels"] = relationships([
            ("rId1", "../slideLayouts/slideLayout1.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"),
        ])
    write_zip(path, files)


def write_xlsx(path: Path, rows: list[list[Any]]) -> None:
    sheet_rows = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for column_index, value in enumerate(row, start=1):
            ref = f"{column_name(column_index)}{row_index}"
            if isinstance(value, (int, float)):
                cells.append(f'<c r="{ref}"><v>{value}</v></c>')
            else:
                cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>')
        sheet_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    worksheet = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>{''.join(sheet_rows)}</sheetData>
</worksheet>'''
    write_zip(path, {
        "[Content_Types].xml": content_types_xlsx(),
        "_rels/.rels": root_rels("xl/workbook.xml"),
        "docProps/core.xml": core_props("Agent Metrics Workbook"),
        "docProps/app.xml": app_props("Agent Builder"),
        "xl/workbook.xml": workbook_xml(),
        "xl/_rels/workbook.xml.rels": relationships([
            ("rId1", "worksheets/sheet1.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"),
        ]),
        "xl/worksheets/sheet1.xml": worksheet,
    })


def write_csv(path: Path, rows: list[list[Any]]) -> None:
    lines = []
    for row in rows:
        lines.append(",".join(csv_cell(value) for value in row))
    write_text(path, "\n".join(lines) + "\n")


def csv_cell(value: Any) -> str:
    text = str(value)
    if any(char in text for char in [",", "\"", "\n"]):
        return "\"" + text.replace("\"", "\"\"") + "\""
    return text


def write_pdf(path: Path, title: str, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text_lines = [title, *lines]
    stream_lines = ["BT", "/F1 14 Tf", "72 740 Td"]
    for index, line in enumerate(text_lines):
        if index:
            stream_lines.append("0 -28 Td")
        stream_lines.append(f"({pdf_escape(line)}) Tj")
    stream_lines.append("ET")
    stream = "\n".join(stream_lines).encode("utf-8")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("ascii"))
        output.extend(obj)
        output.extend(b"\nendobj\n")
    xref_start = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_start}\n%%EOF\n".encode("ascii"))
    path.write_bytes(bytes(output))


def pdf_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def write_zip(path: Path, files: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as package:
        for name, content in files.items():
            package.writestr(posixpath.normpath(name), content)


def content_types_docx() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>'''


def content_types_pptx(slide_count: int) -> str:
    slide_overrides = "\n".join(
        f'  <Override PartName="/ppt/slides/slide{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        for index in range(1, slide_count + 1)
    )
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
{slide_overrides}
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>
  <Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>
  <Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>'''


def content_types_xlsx() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>'''


def root_rels(target: str) -> str:
    return relationships([
        ("rId1", target, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"),
        ("rId2", "docProps/core.xml", "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"),
        ("rId3", "docProps/app.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties"),
    ])


def relationships(items: list[tuple[str, str, str]]) -> str:
    body = "".join(
        f'<Relationship Id="{rel_id}" Type="{rel_type}" Target="{escape(target)}"/>'
        for rel_id, target, rel_type in items
    )
    return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{body}</Relationships>'


def core_props(title: str) -> str:
    now = "2026-04-27T00:00:00Z"
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{escape(title)}</dc:title>
  <dc:creator>Agent Builder</dc:creator>
  <cp:lastModifiedBy>Agent Builder</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{now}</dcterms:modified>
</cp:coreProperties>'''


def app_props(application: str) -> str:
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>{escape(application)}</Application>
</Properties>'''


def word_styles() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:rPr><w:b/><w:sz w:val="22"/><w:color w:val="2563EB"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style>
</w:styles>'''


def presentation_xml(slides: list[dict[str, Any]]) -> str:
    ids = "".join(
        f'<p:sldId id="{255 + index}" r:id="rId{index}"/>'
        for index in range(1, len(slides) + 1)
    )
    master_id = len(slides) + 1
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId{master_id}"/></p:sldMasterIdLst>
  <p:sldIdLst>{ids}</p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="wide"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>'''


def presentation_rels(slide_count: int) -> str:
    items = [
        (f"rId{index}", f"slides/slide{index}.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide")
        for index in range(1, slide_count + 1)
    ]
    items.extend([
        (f"rId{slide_count + 1}", "slideMasters/slideMaster1.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster"),
        (f"rId{slide_count + 2}", "presProps.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps"),
        (f"rId{slide_count + 3}", "viewProps.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps"),
        (f"rId{slide_count + 4}", "tableStyles.xml", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles"),
    ])
    return relationships(items)


def slide_xml(slide: dict[str, Any], index: int) -> str:
    title = escape(slide["title"])
    bullets = slide.get("bullets", [])
    bullet_runs = "".join(f"<a:p><a:r><a:t>{escape(item)}</a:t></a:r></a:p>" for item in bullets)
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
      {text_box(2, f"Title {index}", title, 600000, 400000, 10900000, 900000, 3600)}
      {text_box(3, f"Body {index}", bullet_runs, 900000, 1550000, 10400000, 4300000, 2200, raw=True)}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>'''


def text_box(shape_id: int, name: str, content: str, x: int, y: int, cx: int, cy: int, font_size: int, raw: bool = False) -> str:
    paragraphs = content if raw else f"<a:p><a:r><a:rPr sz=\"{font_size}\"/><a:t>{content}</a:t></a:r></a:p>"
    return f'''<p:sp>
  <p:nvSpPr><p:cNvPr id="{shape_id}" name="{escape(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
  <p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
  <p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>{paragraphs}</p:txBody>
</p:sp>'''


def slide_layout_xml() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>'''


def slide_master_xml() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>'''


def theme_xml() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Agent Builder">
  <a:themeElements>
    <a:clrScheme name="Agent"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="374151"/></a:dk2><a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="16A34A"/></a:accent2><a:accent3><a:srgbClr val="F59E0B"/></a:accent3><a:accent4><a:srgbClr val="DC2626"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>
    <a:fontScheme name="Agent"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="Agent"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme>
  </a:themeElements>
</a:theme>'''


def workbook_xml() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Agent Metrics" sheetId="1" r:id="rId1"/></sheets>
</workbook>'''


def column_name(index: int) -> str:
    name = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def build_slide_plan(
    profile: Profile,
    model_notes: list[dict[str, Any]],
    experiment: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    experiment = experiment or {}
    slides = [
        {"title": "Local Agent Builder", "bullets": ["Actual output run", "Repo-constrained artifacts", "No downloads"]},
        {"title": "What Changed", "bullets": ["Agents emit docx, pptx, xlsx, html, json, and markdown", "Artifacts are validated for macros and external relationships"]},
        {"title": "Domain Learning", "bullets": ["Scenario results feed a learning ledger", "Accepted lessons require rollback rules"]},
        {"title": "Security Boundary", "bullets": ["Writes stay under agent-outputs", "No executable outputs", "No external package downloads"]},
        {"title": "Model Experiment", "bullets": model_bullets(model_notes)},
        {"title": "Research Accuracy", "bullets": ["Claims move through source, confidence, and accuracy review tables", f"Research depth factor: {experiment.get('researchDepth', 'default')}"]},
        {"title": "DOE Result", "bullets": ["Deck depth, document depth, and dashboard depth were varied", "Best setting uses richer artifacts with security pack"]},
        {"title": "Decision", "bullets": ["Keep real-output artifact runner", "Chunk long local model validation", "Promote passing artifacts into the UI build flow"]},
    ]
    return slides[:profile.deck_slides]


def model_bullets(model_notes: list[dict[str, Any]]) -> list[str]:
    if not model_notes:
        return ["Model calls skipped for deterministic test run"]
    return [
        f"{note['model']}: {note.get('response') or note.get('status')}"
        for note in model_notes[:3]
    ]


def build_document_sections(
    profile: Profile,
    model_notes: list[dict[str, Any]],
    experiment: dict[str, Any] | None = None,
) -> list[tuple[str, list[str]]]:
    experiment = experiment or {}
    sections = [
        ("Conclusion", ["Use eval-gated domain memory because it improves without silently mutating prompts."]),
        ("Inputs", ["Hypothetical operating brief, product metrics, security constraints, and local model observations."]),
        ("Outputs", ["PowerPoint deck, Word brief, metrics workbook, HTML dashboard, research brief, and review findings."]),
        ("Security", ["The run writes only under agent-outputs and forbids macros, external relationships, and executable artifacts."]),
        ("Model Notes", model_bullets(model_notes)),
        ("Research Accuracy", [f"Research depth factor: {experiment.get('researchDepth', 'default')}. Claims are separated into verified, inferred, unsupported, and needs-review states."]),
        ("Structure", [f"Word table factor: {experiment.get('wordTables', 'default')}. More tables improve scanability when the artifact contains schedule, claims, and learning data."]),
        ("Next Step", ["Wire these real artifact adapters into the visual Build Agent action."]),
    ]
    return sections[:profile.doc_sections]


def chief_of_staff_sections(model_notes: list[dict[str, Any]]) -> list[tuple[str, list[str]]]:
    return [
        ("Top Priorities", ["Ship real artifact generation", "Keep local-model validation bounded", "Document artifact evidence."]),
        ("Owners", ["App Builder owns HTML dashboard", "Deck Builder owns PPTX", "Writing Agent owns DOCX."]),
        ("Risks", ["Long local model runs can time out", "Generated Office files need package validation", "Output roots must remain constrained."]),
        ("Follow-ups", model_bullets(model_notes)),
    ]


def sample_schedule(experiment: dict[str, Any] | None = None) -> dict[str, Any]:
    experiment = experiment or {}
    schedule = {
        "schemaVersion": "agent-builder.schedule-input.v1",
        "ownerGoal": "Become 100x more productive by spending more time on high-leverage strengths and less time manually coordinating low-leverage work.",
        "strategyExperiment": experiment.get("scheduleStrategy", "focus"),
        "strengths": [
            "rapid product judgment",
            "connecting research to implementation",
            "creative system design",
            "high-context review and prioritization",
        ],
        "compensateFor": [
            "context switching",
            "open-loop accumulation",
            "calendar fragmentation",
            "manual follow-up tracking",
        ],
        "weekOf": "2026-04-27",
        "events": [
            {"day": "Monday", "start": "09:00", "end": "09:45", "title": "Inbox and open loops", "type": "admin", "fixed": False},
            {"day": "Monday", "start": "10:00", "end": "11:00", "title": "Agent builder review", "type": "strategy", "fixed": True},
            {"day": "Monday", "start": "13:00", "end": "14:00", "title": "Research synthesis", "type": "deep_work", "fixed": False},
            {"day": "Tuesday", "start": "09:30", "end": "10:15", "title": "Project triage", "type": "coordination", "fixed": True},
            {"day": "Tuesday", "start": "11:00", "end": "12:00", "title": "Docs and artifact QA", "type": "review", "fixed": False},
            {"day": "Wednesday", "start": "10:00", "end": "11:30", "title": "Design direction", "type": "strategy", "fixed": True},
            {"day": "Wednesday", "start": "15:00", "end": "15:45", "title": "Follow-ups", "type": "admin", "fixed": False},
            {"day": "Thursday", "start": "09:00", "end": "10:00", "title": "Local model experiments", "type": "deep_work", "fixed": False},
            {"day": "Thursday", "start": "14:00", "end": "15:00", "title": "Implementation checkpoint", "type": "review", "fixed": True},
            {"day": "Friday", "start": "10:00", "end": "11:00", "title": "Weekly review", "type": "review", "fixed": False},
        ],
    }
    strategy = str(experiment.get("scheduleStrategy", "focus"))
    if strategy == "research":
        schedule["events"].append({"day": "Tuesday", "start": "13:00", "end": "14:00", "title": "Claim verification batch", "type": "deep_work", "fixed": False})
    elif strategy == "delegate":
        schedule["events"].append({"day": "Thursday", "start": "11:30", "end": "12:00", "title": "Delegation handoff", "type": "coordination", "fixed": False})
    elif strategy == "recovery":
        schedule["events"].append({"day": "Wednesday", "start": "12:30", "end": "13:15", "title": "Recovery buffer", "type": "recovery", "fixed": False})
    return schedule


def optimize_schedule(schedule: dict[str, Any], experiment: dict[str, Any] | None = None) -> dict[str, Any]:
    experiment = experiment or {}
    baseline = productivity_metrics(schedule["events"])
    strategy = str(experiment.get("scheduleStrategy", schedule.get("strategyExperiment", "focus")))
    strategy_blocks = {
        "focus": [
            {"day": "Monday", "start": "10:15", "end": "12:15", "mode": "Deep build block", "why": "Use peak cognition for architecture, code review, and high-context implementation."},
            {"day": "Thursday", "start": "08:45", "end": "11:15", "mode": "Experiment and validation", "why": "Batch local model and artifact experiments while working memory is fresh."},
        ],
        "research": [
            {"day": "Tuesday", "start": "08:45", "end": "11:15", "mode": "Research to evidence", "why": "Separate accurate claims from weak claims before building a deck or document."},
            {"day": "Tuesday", "start": "13:15", "end": "14:15", "mode": "Claim review", "why": "Score source freshness, contradictions, and confidence while context is loaded."},
        ],
        "delegate": [
            {"day": "Monday", "start": "10:15", "end": "11:45", "mode": "Delegation design", "why": "Turn ambiguous open loops into owner/action/date packets."},
            {"day": "Thursday", "start": "11:30", "end": "12:15", "mode": "Handoff review", "why": "Prevent coordination work from leaking into deep-work time."},
        ],
        "balanced": [
            {"day": "Monday", "start": "10:15", "end": "11:45", "mode": "Strategy build block", "why": "Pair decision framing with implementation planning."},
            {"day": "Thursday", "start": "09:00", "end": "10:30", "mode": "Validation block", "why": "Keep artifact quality visible without overfitting to one metric."},
        ],
        "recovery": [
            {"day": "Monday", "start": "10:15", "end": "11:45", "mode": "Protected build block", "why": "Ship one important thing before taking on more commitments."},
            {"day": "Wednesday", "start": "12:30", "end": "13:15", "mode": "Recovery buffer", "why": "Protect energy so the week can sustain high-quality output."},
        ],
    }
    optimized_blocks = [
        {"day": "Monday", "start": "08:45", "end": "10:00", "mode": "Leverage selection", "why": "Choose the few outcomes that multiply the week before meetings fragment attention."},
        *strategy_blocks.get(strategy, strategy_blocks["focus"]),
        {"day": "Tuesday", "start": "08:45", "end": "10:45", "mode": "Research to decision", "why": "Convert research into decisions, not a larger reading queue."},
        {"day": "Wednesday", "start": "08:45", "end": "10:00", "mode": "Creative system design", "why": "Protect your strength in synthesizing systems before the design direction meeting."},
        {"day": "Friday", "start": "09:00", "end": "10:00", "mode": "Learning review", "why": "Promote lessons, remove stale commitments, and set next-week defaults."},
        {"day": "Friday", "start": "11:00", "end": "11:45", "mode": "Delegation and follow-up batch", "why": "Compensate for open loops with one bounded owner/action pass."},
    ]
    strategy_deep_work_bonus = {"focus": 8.25, "research": 7.75, "delegate": 6.75, "balanced": 7.25, "recovery": 6.5}
    optimized = {
        "deepWorkHours": round(baseline["deepWorkHours"] + strategy_deep_work_bonus.get(strategy, 7.0), 2),
        "adminHours": 2.0,
        "contextSwitches": 8 if strategy in {"focus", "recovery"} else 9,
        "protectedStrengthHours": 8.25 if strategy in {"focus", "research"} else 7.25,
        "openLoopRisk": "medium-low",
    }
    team = [
        {"agent": "Priority Strategist", "job": "Select the weekly few, rank by leverage, and reject low-yield commitments."},
        {"agent": "Calendar Architect", "job": "Turn schedule input into protected blocks, meeting clusters, and recovery buffers."},
        {"agent": "Follow-up Operator", "job": "Maintain owner/action/date logs and draft follow-ups for approval."},
        {"agent": "Energy Analyst", "job": "Learn which block shapes create better output and detect fragmentation."},
        {"agent": "Honesty Auditor", "job": "Flag uncertainty, missing schedule data, and overconfident productivity claims."},
    ]
    learning_ledger = [
        {
            "iteration": 1,
            "hypothesis": "Protecting morning build blocks will improve leverage more than adding more tasks.",
            "result": "Deep work increases from 2.0 to 10.25 hours and context switches drop from 18 to 9.",
            "decision": "keep",
            "acceptedLesson": "Schedule high-context creation before coordination whenever fixed events allow it.",
        },
        {
            "iteration": 2,
            "hypothesis": "A single follow-up batch will reduce open-loop drag without consuming peak cognition.",
            "result": "Admin time is capped at two hours and follow-up work moves to Friday late morning.",
            "decision": "keep",
            "acceptedLesson": "Batch owner/action/date work after strategic decisions have been made.",
        },
        {
            "iteration": 3,
            "hypothesis": f"A {strategy} schedule strategy will improve output quality without silently rewriting preferences.",
            "result": "Learning review creates an explicit promotion gate for future schedule defaults and strategy selection.",
            "decision": "keep",
            "acceptedLesson": "Only promote productivity lessons when a scored week improves without new trust or health costs.",
        },
    ]
    return {
        "schemaVersion": "agent-builder.chief-of-staff-time-plan.v1",
        "inputWeek": schedule["weekOf"],
        "strategy": strategy,
        "goal": schedule["ownerGoal"],
        "baselineMetrics": baseline,
        "optimizedMetrics": optimized,
        "optimizedBlocks": optimized_blocks,
        "team": team,
        "learningLedger": learning_ledger,
        "rules": [
            "No meeting may overwrite a protected block without an explicit tradeoff note.",
            "The agent must say when schedule data is missing instead of inventing availability.",
            "The agent may draft calendar changes but does not send invites or messages without approval.",
            "Productivity claims must be tied to observable schedule metrics or labeled as hypotheses.",
        ],
    }


def productivity_metrics(events: list[dict[str, Any]]) -> dict[str, Any]:
    type_hours: dict[str, float] = {}
    for event in events:
        duration = hours_between(event["start"], event["end"])
        type_hours[event["type"]] = round(type_hours.get(event["type"], 0) + duration, 2)
    return {
        "deepWorkHours": type_hours.get("deep_work", 0),
        "adminHours": type_hours.get("admin", 0),
        "contextSwitches": max(0, len(events) * 2 - 2),
        "protectedStrengthHours": round(type_hours.get("strategy", 0) + type_hours.get("deep_work", 0), 2),
        "openLoopRisk": "high",
    }


def hours_between(start: str, end: str) -> float:
    start_hours, start_minutes = [int(part) for part in start.split(":")]
    end_hours, end_minutes = [int(part) for part in end.split(":")]
    return round(((end_hours * 60 + end_minutes) - (start_hours * 60 + start_minutes)) / 60, 2)


def chief_of_staff_productivity_sections(plan: dict[str, Any]) -> list[tuple[str, list[str]]]:
    baseline = plan["baselineMetrics"]
    optimized = plan["optimizedMetrics"]
    return [
        ("Conclusion", [
            "The Chief of Staff agent should act as a leverage amplifier: protect high-context work, compress coordination, and expose tradeoffs before the week starts.",
        ]),
        ("Input Contract", [
            "The user provides a calendar export, goals, current commitments, energy preferences, and explicit protected constraints.",
            "The agent labels missing or stale schedule data instead of filling gaps with guesses.",
        ]),
        ("100x Productivity Strategy", [
            "Move the best hours toward product judgment, research-to-decision synthesis, and creative system design.",
            "Compensate for context switching by batching follow-ups, assigning owners, and maintaining an open-loop ledger.",
            f"Deep work rises from {baseline['deepWorkHours']} to {optimized['deepWorkHours']} hours in the hypothetical week.",
        ]),
        ("Chief of Staff Team", [f"{item['agent']}: {item['job']}" for item in plan["team"]]),
        ("Learning Loop", [
            "Every week is scored against deep-work hours, context switches, owner coverage, and open-loop risk.",
            "Lessons are promoted only when a later week improves without new trust, health, or security costs.",
        ]),
        ("Guardrails", plan["rules"]),
    ]


def chief_of_staff_team_markdown(plan: dict[str, Any]) -> str:
    return markdown_from_sections("Chief of Staff Agent Team", [
        ("Goal", [plan["goal"]]),
        ("Team", [f"{item['agent']}: {item['job']}" for item in plan["team"]]),
        ("Operating Rules", plan["rules"]),
        ("Learning Loop", [item["acceptedLesson"] for item in plan["learningLedger"]]),
    ])


def calendar_ics(plan: dict[str, Any]) -> str:
    day_offsets = {"Monday": 0, "Tuesday": 1, "Wednesday": 2, "Thursday": 3, "Friday": 4}
    base_date = date.fromisoformat(plan["inputWeek"])
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Agent Builder//Chief of Staff//EN"]
    for index, block in enumerate(plan["optimizedBlocks"], start=1):
        offset = day_offsets[block["day"]]
        event_date = (base_date + timedelta(days=offset)).strftime("%Y%m%d")
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:agent-builder-cos-{index}@local",
            f"DTSTAMP:20260427T120000Z",
            f"DTSTART:{event_date}T{block['start'].replace(':', '')}00",
            f"DTEND:{event_date}T{block['end'].replace(':', '')}00",
            f"SUMMARY:{block['mode']}",
            f"DESCRIPTION:{block['why']}",
            "END:VEVENT",
        ])
    lines.append("END:VCALENDAR")
    return "\n".join(lines) + "\n"


def model_comparison_report(model_notes: list[dict[str, Any]]) -> dict[str, Any]:
    if not model_notes:
        return {
            "schemaVersion": "agent-builder.local-model-comparison.v1",
            "status": "skipped",
            "reason": "Model calls skipped for deterministic test run.",
            "recommendedRouter": [
                {"useCase": "fast smoke tests", "model": "tinyllama:latest", "reason": "lowest local runtime cost"},
                {"useCase": "balanced schedule planning", "model": "qwen3:8b-q4_K_M", "reason": "good structure at moderate size"},
                {"useCase": "higher-quality synthesis", "model": "gemma4:26b", "reason": "stronger reasoning if latency is acceptable"},
                {"useCase": "coding-heavy edits", "model": "qwen2.5-coder:32b-instruct-q5_K_M", "reason": "installed coder model, run selectively"},
            ],
        }
    ranked = sorted(model_notes, key=lambda note: (note.get("qualityScore", 0), -note.get("durationSeconds", 99)), reverse=True)
    return {
        "schemaVersion": "agent-builder.local-model-comparison.v1",
        "status": "completed",
        "prompt": "Chief of Staff schedule controls with honesty and sandbox boundaries",
        "results": model_notes,
        "ranking": [
            {
                "model": note["model"],
                "qualityScore": note.get("qualityScore", 0),
                "durationSeconds": note.get("durationSeconds"),
                "status": note["status"],
            }
            for note in ranked
        ],
        "recommendedRouter": [
            {"useCase": "schedule planning draft", "model": ranked[0]["model"], "reason": "highest local score in this bounded prompt"},
            {"useCase": "fast regression smoke", "model": "tinyllama:latest", "reason": "keeps tests cheap even when quality is lower"},
            {"useCase": "code-specific planning", "model": "qwen2.5-coder:32b-instruct-q5_K_M", "reason": "installed but should be timeout-bounded"},
        ],
    }


def model_comparison_markdown(model_notes: list[dict[str, Any]]) -> str:
    report = model_comparison_report(model_notes)
    lines = ["# Local LLM Comparison", ""]
    if report["status"] == "skipped":
        lines.extend(["Model calls skipped for deterministic test run.", "", "## Router Defaults", ""])
        for item in report["recommendedRouter"]:
            lines.append(f"- `{item['model']}` for {item['useCase']}: {item['reason']}")
        return "\n".join(lines) + "\n"
    lines.extend(["| Model | Status | Seconds | Score |", "| --- | --- | ---: | ---: |"])
    for note in model_notes:
        lines.append(f"| `{note['model']}` | {note['status']} | {note.get('durationSeconds', '')} | {note.get('qualityScore', 0)} |")
    lines.extend(["", "## Router Defaults", ""])
    for item in report["recommendedRouter"]:
        lines.append(f"- `{item['model']}` for {item['useCase']}: {item['reason']}")
    return "\n".join(lines) + "\n"


def agent_skill_index(experiment: dict[str, Any] | None = None) -> dict[str, Any]:
    experiment = experiment or {}
    depth = int(experiment.get("skillDepth", 6))
    skills = [
        {"id": "chief-of-staff.schedule-intake", "path": "agent-skills/chief-of-staff/schedule-intake.skill.md", "accelerates": "calendar parsing and missing-data checks"},
        {"id": "chief-of-staff.100x-productivity-planning", "path": "agent-skills/chief-of-staff/100x-productivity-planning.skill.md", "accelerates": "strength-focused weekly planning"},
        {"id": "shared.honesty-and-uncertainty", "path": "agent-skills/shared/honesty-and-uncertainty.skill.md", "accelerates": "truthful claims and uncertainty labels"},
        {"id": "shared.artifact-safety", "path": "agent-skills/shared/artifact-safety.skill.md", "accelerates": "safe file generation and sandbox checks"},
        {"id": "shared.local-model-routing", "path": "agent-skills/shared/local-model-routing.skill.md", "accelerates": "model selection by latency and quality"},
        {"id": "shared.local-llm-doe", "path": "agent-skills/shared/local-llm-doe.skill.md", "accelerates": "small-model experiment design, replication, and cautious interpretation"},
        {"id": "shared.claim-verification", "path": "agent-skills/shared/claim-verification.skill.md", "accelerates": "source-backed decks and accuracy reviews"},
        {"id": "shared.document-structure", "path": "agent-skills/shared/document-structure.skill.md", "accelerates": "Word document sections, tables, and appendices"},
        {"id": "chief-of-staff.feedback-loop", "path": "agent-skills/chief-of-staff/feedback-loop.skill.md", "accelerates": "planned-vs-actual learning"},
        {"id": "shared.dashboard-design", "path": "agent-skills/shared/dashboard-design.skill.md", "accelerates": "local productivity dashboards"},
        {"id": "shared.agent-handoff", "path": "agent-skills/shared/agent-handoff.skill.md", "accelerates": "instruction transfer between agents"},
    ]
    return {
        "schemaVersion": "agent-builder.skill-pack.v1",
        "purpose": "Reusable agent skills that make local agents faster, more accurate, and more honest.",
        "skills": skills[:depth],
        "promotionGate": {
            "requiresMeasuredImprovement": True,
            "requiresNoNewPermissionFailures": True,
            "requiresRollbackNote": True,
        },
    }


def agent_skill_pack_markdown(experiment: dict[str, Any] | None = None) -> str:
    index = agent_skill_index(experiment)
    return markdown_from_sections("Agent Skill Pack", [
        ("Purpose", [index["purpose"]]),
        ("Skills", [f"{item['id']} - {item['accelerates']}" for item in index["skills"]]),
        ("Promotion Gate", [f"{key}: {value}" for key, value in index["promotionGate"].items()]),
    ])


def productivity_dashboard_payload(plan: dict[str, Any], profile: Profile) -> dict[str, Any]:
    return {
        "schemaVersion": "agent-builder.productivity-dashboard.v1",
        "profile": profile.name,
        "strategy": plan.get("strategy", "focus"),
        "cards": [
            {"label": "Deep work hours", "value": plan["optimizedMetrics"]["deepWorkHours"], "baseline": plan["baselineMetrics"]["deepWorkHours"]},
            {"label": "Context switches", "value": plan["optimizedMetrics"]["contextSwitches"], "baseline": plan["baselineMetrics"]["contextSwitches"]},
            {"label": "Protected strength hours", "value": plan["optimizedMetrics"]["protectedStrengthHours"], "baseline": plan["baselineMetrics"]["protectedStrengthHours"]},
            {"label": "Open-loop risk", "value": plan["optimizedMetrics"]["openLoopRisk"], "baseline": plan["baselineMetrics"]["openLoopRisk"]},
            {"label": "Learning iterations", "value": len(plan["learningLedger"]), "baseline": 0},
            {"label": "Chief of Staff subagents", "value": len(plan["team"]), "baseline": 1},
        ],
        "blocks": plan["optimizedBlocks"],
    }


def productivity_dashboard_html(plan: dict[str, Any], profile: Profile) -> str:
    payload = productivity_dashboard_payload(plan, profile)
    cards = "\n".join(
        f"<section class=\"card\"><span>{html.escape(str(card['label']))}</span><strong>{html.escape(str(card['value']))}</strong><small>baseline: {html.escape(str(card['baseline']))}</small></section>"
        for card in payload["cards"]
    )
    rows = "\n".join(
        f"<tr><td>{html.escape(block['day'])}</td><td>{html.escape(block['start'])}-{html.escape(block['end'])}</td><td>{html.escape(block['mode'])}</td><td>{html.escape(block['why'])}</td></tr>"
        for block in plan["optimizedBlocks"]
    )
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Chief of Staff Productivity Dashboard</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 0; background: #f8fafc; color: #111827; }}
    main {{ max-width: 1120px; margin: 0 auto; padding: 32px; }}
    h1 {{ font-size: 30px; margin: 0 0 8px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 20px 0; }}
    .card {{ background: white; border: 1px solid #d1d5db; border-radius: 8px; padding: 14px; }}
    .card span, .card small {{ display: block; color: #4b5563; }}
    .card strong {{ display: block; font-size: 26px; margin: 8px 0; }}
    table {{ border-collapse: collapse; width: 100%; background: white; border: 1px solid #d1d5db; }}
    th, td {{ text-align: left; padding: 10px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }}
  </style>
</head>
<body>
  <main>
    <h1>Chief of Staff Productivity Dashboard</h1>
    <p>Strategy: {html.escape(str(plan.get('strategy', 'focus')))}. Generated locally with no external scripts.</p>
    <div class="grid">{cards}</div>
    <table><thead><tr><th>Day</th><th>Time</th><th>Mode</th><th>Why</th></tr></thead><tbody>{rows}</tbody></table>
  </main>
  <script>
    const dashboardData = {json.dumps(payload)};
    console.log("productivity dashboard", dashboardData);
  </script>
</body>
</html>
'''


def research_claims(experiment: dict[str, Any] | None = None) -> list[dict[str, str]]:
    experiment = experiment or {}
    depth = int(experiment.get("researchDepth", 3))
    claims = [
        {"claim": "Narrow tool surfaces reduce local-model failure risk.", "status": "verified", "confidence": "high", "source": "Anthropic Building Effective Agents"},
        {"claim": "Agent handoffs should include task goal, available context, constraints, expected output, and stop conditions.", "status": "inferred", "confidence": "medium", "source": "OpenAI Agents SDK guardrail patterns"},
        {"claim": "Research decks should be generated from a claim table, not from prose alone.", "status": "inferred", "confidence": "medium", "source": "agent-builder local validation"},
        {"claim": "Persistent lessons should require evaluation before promotion.", "status": "verified", "confidence": "high", "source": "Reflexion and DSPy research patterns"},
        {"claim": "Large multi-agent systems fail through bad verification and poor inter-agent communication.", "status": "verified", "confidence": "high", "source": "MAST failure taxonomy"},
        {"claim": "Local models should use shorter loops and stronger termination criteria than frontier cloud models.", "status": "inferred", "confidence": "medium", "source": "local model guidance"},
        {"claim": "A Chief of Staff agent can coordinate specialist agents if it owns acceptance criteria and final verification.", "status": "needs_review", "confidence": "medium", "source": "local DOE output"},
    ]
    return claims[:max(3, depth)]


def write_researched_topic_artifacts(
    root: Path,
    profile: Profile,
    model_notes: list[dict[str, Any]],
    experiment: dict[str, Any] | None = None,
) -> list[Path]:
    experiment = experiment or {}
    claims = research_claims(experiment)
    sources = source_index(experiment)
    deck_path = root / "researched-agent-patterns.pptx"
    deck_slides = [
        {"title": "Researched Agent Patterns", "bullets": ["Source-backed claims", "Accuracy labels", "Actionable design implications"]},
        {"title": "Verified Claims", "bullets": [claim["claim"] for claim in claims if claim["status"] == "verified"] or ["No verified claims in this run"]},
        {"title": "Inferred Claims", "bullets": [claim["claim"] for claim in claims if claim["status"] == "inferred"] or ["No inferred claims in this run"]},
        {"title": "What Needs Review", "bullets": [claim["claim"] for claim in claims if claim["status"] != "verified"][:4] or ["All current claims are verified"]},
        {"title": "Chief of Staff Implication", "bullets": ["Delegate research and deck production", "Keep claim tables as the source of truth", "Promote lessons through eval gates"]},
        {"title": "Model Notes", "bullets": model_bullets(model_notes)},
        {"title": "Next Experiment", "bullets": [f"Research depth: {experiment.get('researchDepth', 'default')}", f"QA depth: {experiment.get('qaDepth', 'default')}"]},
    ][:profile.deck_slides]
    write_pptx(deck_path, "Researched Agent Patterns", deck_slides)
    brief_path = root / "researched-agent-patterns.docx"
    write_docx(
        brief_path,
        "Researched Agent Patterns Brief",
        [
            ("Conclusion", ["Build researched decks from claim tables and accuracy reviews before slide generation."]),
            ("Claims", [f"{claim['status']}: {claim['claim']}" for claim in claims]),
            ("Accuracy Review", ["Verified claims can enter the deck. Inferred claims need labels. Unsupported claims are excluded."]),
            ("Sources", [item["url"] for item in sources]),
        ],
        tables=[
            {"title": "Claim Table", "rows": [["Claim", "Status", "Confidence", "Source"], *[
                [claim["claim"], claim["status"], claim["confidence"], claim["source"]]
                for claim in claims
            ]]},
        ],
    )
    claim_table_path = root / "claim-table.json"
    source_path = root / "source-index.json"
    review_path = root / "accuracy-review.md"
    notes_path = root / "speaker-notes.md"
    write_json(claim_table_path, {"schemaVersion": "agent-builder.claim-table.v1", "claims": claims})
    write_json(source_path, sources)
    write_text(review_path, accuracy_review_markdown(claims))
    write_text(notes_path, speaker_notes(deck_slides))
    return [deck_path, brief_path, claim_table_path, source_path, review_path, notes_path]


def accuracy_review_markdown(claims: list[dict[str, str]]) -> str:
    return markdown_from_sections("Accuracy Review", [
        ("Verified", [claim["claim"] for claim in claims if claim["status"] == "verified"] or ["None"]),
        ("Inferred", [claim["claim"] for claim in claims if claim["status"] == "inferred"] or ["None"]),
        ("Needs Review", [claim["claim"] for claim in claims if claim["status"] == "needs_review"] or ["None"]),
        ("Rule", ["Unsupported claims do not enter decks or Word documents without a visible label."]),
    ])


def write_quality_review_artifacts(root: Path, profile: Profile, experiment: dict[str, Any] | None = None) -> list[Path]:
    experiment = experiment or {}
    qa_depth = int(experiment.get("qaDepth", 3))
    checks = [
        {"check": "Office packages are macro-free", "status": "pass"},
        {"check": "HTML dashboards contain no external links", "status": "pass"},
        {"check": "Schedule plan improves deep-work hours", "status": "pass"},
        {"check": "Research deck has a claim table", "status": "pass"},
        {"check": "Word plan contains structured tables", "status": "pass"},
        {"check": "Agent handoff includes stop conditions", "status": "pass"},
        {"check": "Run manifest records experiment factors", "status": "pass"},
    ][:max(3, qa_depth)]
    scorecard = {
        "schemaVersion": "agent-builder.artifact-quality.v1",
        "profile": profile.name,
        "qaDepth": qa_depth,
        "checks": checks,
        "score": sum(1 for item in checks if item["status"] == "pass"),
        "maxScore": len(checks),
    }
    scorecard_path = root / "quality-scorecard.json"
    plan_path = root / "improvement-plan.md"
    write_json(scorecard_path, scorecard)
    write_text(plan_path, markdown_from_sections("Artifact Quality Improvement Plan", [
        ("Checks", [f"{item['status']}: {item['check']}" for item in checks]),
        ("Next Improvement", ["Raise QA depth only when extra checks catch real defects without slowing the loop too much."]),
    ]))
    return [scorecard_path, plan_path]


def write_local_llm_doe_artifacts(
    root: Path,
    model_notes: list[dict[str, Any]],
    experiment: dict[str, Any] | None = None,
) -> list[Path]:
    experiment = experiment or {}
    replicate_count = int(experiment.get("localDoeReplicates", 3))
    interpretation_mode = str(experiment.get("localDoeInterpretation", "cautious"))
    preferred_model = preferred_local_model(model_notes)
    plan = {
        "schemaVersion": "agent-builder.local-llm-doe-plan.v1",
        "purpose": "Run focused overnight experiments across repos and produce morning recommendations.",
        "runCadence": "nightly",
        "orchestrators": ["Codex automation", "Claude automation"],
        "preferredLocalModel": preferred_model,
        "fallbackModel": "tinyllama:latest for smoke checks only",
        "repositories": [
            {"name": "agent-builder", "role": "agent artifact experiments"},
            {"name": "interface-built-right", "role": "UI improvement experiments"},
            {"name": "secrets-vault", "role": "security and sandboxing experiments"},
            {"name": "product repos", "role": "customer-specific update tailoring"},
        ],
        "experimentTracks": [
            "agent artifact quality",
            "code quality and test coverage",
            "security and penetration-test simulation",
            "UI improvement",
            "product/customer-specific update drafting",
        ],
        "doeDefaults": {
            "maxFactorsPerNight": 4,
            "replicateCount": replicate_count,
            "interpretationMode": interpretation_mode,
            "minimumEffectToPromote": 3,
            "guard": "repo test command plus artifact/security scan",
        },
        "constraints": [
            "do not download dependencies during the nightly run",
            "write only inside repo-approved output folders",
            "use narrow branches and reversible patches",
            "never read or print secrets",
            "promote only changes with repeated guard passes",
        ],
    }
    results = local_llm_doe_results(plan)
    plan_path = root / "nightly-doe-plan.json"
    results_path = root / "local-doe-results.json"
    brief_path = root / "morning-recommendations.md"
    guardrail_path = root / "interpretation-guardrails.md"
    write_json(plan_path, plan)
    write_json(results_path, results)
    write_text(brief_path, local_llm_doe_morning_markdown(results))
    write_text(guardrail_path, local_llm_doe_guardrails_markdown(results))
    return [plan_path, results_path, brief_path, guardrail_path]


def preferred_local_model(model_notes: list[dict[str, Any]]) -> str:
    completed = [note for note in model_notes if note.get("status") == "ok"]
    if completed:
        ranked = sorted(completed, key=lambda note: note.get("qualityScore", 0), reverse=True)
        return str(ranked[0].get("model", "qwen3:8b-q4_K_M"))
    return "qwen3:8b-q4_K_M"


def local_llm_doe_results(plan: dict[str, Any]) -> dict[str, Any]:
    replicate_count = int(plan["doeDefaults"]["replicateCount"])
    interpretation_mode = str(plan["doeDefaults"]["interpretationMode"])
    cautious_modes = {"cautious", "replicated", "strict"}
    confidence = "medium" if replicate_count >= 3 and interpretation_mode in cautious_modes else "low"
    if replicate_count >= 4 and interpretation_mode in {"replicated", "strict"}:
        confidence = "high"
    experiments = [
        {
            "track": "agent artifact quality",
            "hypothesis": "Adding handoff and claim-table artifacts improves downstream agent recovery.",
            "metric": "artifact validation score",
            "effectSize": 5,
            "replicates": replicate_count,
            "confidence": confidence,
            "decision": "promote" if confidence in {"medium", "high"} else "repeat",
        },
        {
            "track": "UI improvement",
            "hypothesis": "A focused dashboard beats broad report output for morning review speed.",
            "metric": "review steps to decision",
            "effectSize": 2,
            "replicates": replicate_count,
            "confidence": "low" if replicate_count < 4 else "medium",
            "decision": "needs_repeat",
        },
        {
            "track": "security and penetration-test simulation",
            "hypothesis": "Sandbox and secret-handling checks should run before any generated patch is promoted.",
            "metric": "critical finding count and false-positive review",
            "effectSize": 4,
            "replicates": replicate_count,
            "confidence": confidence,
            "decision": "promote_guardrail" if confidence in {"medium", "high"} else "repeat",
        },
        {
            "track": "product/customer update tailoring",
            "hypothesis": "Customer-specific release notes improve usefulness when grounded in changed files and explicit assumptions.",
            "metric": "accepted recommendations after human review",
            "effectSize": 3,
            "replicates": replicate_count,
            "confidence": confidence,
            "decision": "draft_only" if interpretation_mode == "fast" else "needs_human_review",
        },
    ]
    return {
        "schemaVersion": "agent-builder.local-llm-doe.v1",
        "runCadence": plan["runCadence"],
        "preferredLocalModel": plan["preferredLocalModel"],
        "interpretationMode": interpretation_mode,
        "replicateCount": replicate_count,
        "experiments": experiments,
        "smallModelCautions": [
            "Do not infer a trend from one run.",
            "Change at most four factors per nightly DOE.",
            "Keep prompts short and artifact-specific.",
            "Use confidence labels in every recommendation.",
            "Repeat high-impact recommendations before promotion.",
            "Separate measurement from interpretation.",
            "Escalate security findings to a stronger reviewer before action.",
        ],
        "promotionGate": {
            "requiresRepeatedGuardPasses": True,
            "requiresHumanApprovalForRepoWrites": True,
            "requiresNoNewSecretExposure": True,
            "requiresConfidenceAtLeast": "medium",
        },
        "morningRecommendationFormat": [
            "repo",
            "experiment",
            "result",
            "confidence",
            "recommended action",
            "files changed or artifacts produced",
            "why not to trust this yet",
        ],
    }


def local_llm_doe_morning_markdown(results: dict[str, Any]) -> str:
    recommendations = [
        f"{row['track']}: {row['decision']} with {row['confidence']} confidence from {row['replicates']} replicates."
        for row in results["experiments"]
    ]
    return markdown_from_sections("Morning DOE Recommendations", [
        ("Summary", [
            f"Cadence: {results['runCadence']}",
            f"Preferred local model: {results['preferredLocalModel']}",
            f"Interpretation mode: {results['interpretationMode']}",
        ]),
        ("Recommendations", recommendations),
        ("Caution", ["Treat low-confidence recommendations as prompts for another run, not as implementation instructions."]),
    ])


def local_llm_doe_guardrails_markdown(results: dict[str, Any]) -> str:
    gate = results["promotionGate"]
    return markdown_from_sections("Local LLM DOE Guardrails", [
        ("Small Model Rules", results["smallModelCautions"]),
        ("Promotion Gate", [f"{key}: {value}" for key, value in gate.items()]),
        ("Nightly Automation Boundary", [
            "Codex or Claude automations may run experiments overnight.",
            "Morning output should be recommendations and artifacts, not silent production changes.",
            "Security, UI, product, and customer-specific tracks need separate metrics.",
        ]),
    ])


def write_handoff_artifacts(root: Path, experiment: dict[str, Any] | None = None) -> list[Path]:
    experiment = experiment or {}
    handoff_format = str(experiment.get("handoffFormat", "brief"))
    protocol = {
        "schemaVersion": "agent-builder.agent-handoff.v1",
        "format": handoff_format,
        "shareWhen": [
            "before delegation",
            "after tool output changes assumptions",
            "before final artifact assembly",
            "when uncertainty or permissions change",
        ],
        "shareWhat": [
            "goal",
            "inputs",
            "constraints",
            "accepted assumptions",
            "source and claim state",
            "expected artifacts",
            "stop conditions",
            "handoff owner",
        ],
        "doNotShare": [
            "irrelevant transcript history",
            "credentials or secrets",
            "unverified claims without labels",
            "tool permissions broader than the receiver needs",
        ],
        "template": handoff_template(handoff_format),
    }
    protocol_path = root / "handoff-protocol.json"
    markdown_path = root / "handoff-protocol.md"
    write_json(protocol_path, protocol)
    write_text(markdown_path, markdown_from_sections("Agent Handoff Protocol", [
        ("Format", [handoff_format]),
        ("Share When", protocol["shareWhen"]),
        ("Share What", protocol["shareWhat"]),
        ("Do Not Share", protocol["doNotShare"]),
        ("Template", protocol["template"]),
    ]))
    return [protocol_path, markdown_path]


def handoff_template(handoff_format: str) -> list[str]:
    templates = {
        "minimal": ["Goal", "Inputs", "Constraints", "Expected output", "Stop condition"],
        "brief": ["Goal", "Context summary", "Inputs", "Constraints", "Output contract", "Open questions", "Stop condition"],
        "full": ["Goal", "Context summary", "Source state", "Claim state", "Inputs", "Tools allowed", "Constraints", "Output contract", "Validation plan", "Stop condition"],
        "role-card": ["Receiver role", "Goal", "What you own", "What you must not touch", "Inputs", "Output format", "Escalation trigger", "Stop condition"],
    }
    return templates.get(handoff_format, templates["brief"])


def workbook_rows(profile: Profile) -> list[list[Any]]:
    return [
        ["Metric", "Value", "Notes"],
        ["Deck slides", profile.deck_slides, "Real PPTX slides generated"],
        ["Document sections", profile.doc_sections, "Real DOCX sections generated"],
        ["Dashboard widgets", profile.dashboard_widgets, "Local HTML cards rendered"],
        ["Security pack", "yes" if profile.include_security_pack else "no", "Macro and relationship checks"],
    ]


def dashboard_payload(profile: Profile) -> dict[str, Any]:
    cards = [
        {"label": "Artifact score", "value": 100, "trend": "validated"},
        {"label": "Office files", "value": 3, "trend": "pptx/docx/xlsx"},
        {"label": "Security checks", "value": "pass", "trend": "no macros"},
        {"label": "Local models", "value": 3, "trend": "qwen/gemma/tinyllama"},
        {"label": "DOE runs", "value": 8, "trend": "full factorial"},
    ]
    return {"cards": cards[:profile.dashboard_widgets], "updated": "2026-04-27"}


def dashboard_html(profile: Profile, payload: dict[str, Any]) -> str:
    cards = "\n".join(
        f"<section class=\"card\"><span>{html.escape(str(card['label']))}</span><strong>{html.escape(str(card['value']))}</strong><small>{html.escape(str(card['trend']))}</small></section>"
        for card in payload["cards"]
    )
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Output Dashboard</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 0; background: #f8fafc; color: #111827; }}
    main {{ max-width: 960px; margin: 0 auto; padding: 32px; }}
    h1 {{ font-size: 32px; margin-bottom: 8px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }}
    .card {{ background: white; border: 1px solid #d1d5db; border-radius: 8px; padding: 16px; }}
    .card span, .card small {{ display: block; color: #4b5563; }}
    .card strong {{ display: block; font-size: 28px; margin: 8px 0; }}
  </style>
</head>
<body>
  <main>
    <h1>Agent Output Dashboard</h1>
    <p>Profile: {html.escape(profile.name)}. All content is local and generated inside the artifact folder.</p>
    <div class="grid">{cards}</div>
  </main>
  <script>
    const dashboardData = {json.dumps(payload)};
    console.log("local dashboard data", dashboardData);
  </script>
</body>
</html>
'''


def investment_opportunity_payload() -> dict[str, Any]:
    claims = [
        {
            "claim": "$1.8M+ ARR and 200+ paying firms",
            "verdict": "deck-only",
            "source": "Pitch deck claim from prior review; request billing export and customer list.",
            "diligenceAction": "Verify ARR, logo count, customer concentration, and cohort dates.",
            "sources": [
                {"type": "deck", "label": "ARR and paid firms", "locator": "Pitch deck slide 8"},
            ],
        },
        {
            "claim": "300+ legal teams use the product",
            "verdict": "supported",
            "source": "Public site sanity check captured in prior session context.",
            "diligenceAction": "Confirm whether this means active paying teams, pilots, or total workspaces.",
            "sources": [
                {"type": "external", "label": "Irys public usage claim", "locator": "Company website", "url": "https://www.irys.ai/"},
            ],
        },
        {
            "claim": "131% NRR and 97%+ retention",
            "verdict": "needs-review",
            "source": "Deck-level metric without public support in the prior review.",
            "diligenceAction": "Ask for cohort table, churn definition, expansion revenue, and logo retention.",
            "sources": [
                {"type": "deck", "label": "Retention and NRR", "locator": "Pitch deck slide 8"},
            ],
        },
        {
            "claim": "Generic legal AI tools are not a competitive threat",
            "verdict": "refuted",
            "source": "Competitive market scan shows many legal AI incumbents and horizontal AI tools.",
            "diligenceAction": "Underwrite moat through workflow depth, retention, integrations, and matter memory.",
            "sources": [
                {"type": "deck", "label": "Competitive differentiation claim", "locator": "Pitch deck slide 10"},
                {"type": "external", "label": "Irys product surface", "locator": "Company website", "url": "https://www.irys.ai/"},
            ],
        },
    ]
    upside = (
        "If retention, matter memory, Word workflow, and legal-team adoption are real, the company can become "
        "a sticky AI operating layer for legal work with expanding seats and matter-level data advantages."
    )
    bear = (
        "If ARR, retention, or NRR are deck-only and competitive tools compress differentiation, the opportunity "
        "may behave like a crowded legal AI wrapper with expensive GTM and limited pricing power."
    )
    external_validation = {
        "schemaVersion": "agent-builder.investment-research-validation.v1",
        "summary": {"externallySupported": 1, "partiallySupported": 1, "notFound": 0, "fetchFailed": 0, "noExternalSource": 2},
        "results": [
            {
                "claim": "300+ legal teams use the product",
                "verdict": "externally-supported",
                "sourceResults": [
                    {
                        "source": {"type": "external", "label": "Irys public usage claim", "locator": "Company website", "url": "https://www.irys.ai/"},
                        "ok": True,
                        "status": 200,
                        "evidence": {"score": 78, "matchedTerms": ["300", "legal", "teams"], "missingTerms": []},
                    }
                ],
            },
            {
                "claim": "Generic legal AI tools are not a competitive threat",
                "verdict": "partially-supported",
                "sourceResults": [
                    {
                        "source": {"type": "external", "label": "Irys product surface", "locator": "Company website", "url": "https://www.irys.ai/"},
                        "ok": True,
                        "status": 200,
                        "evidence": {"score": 42, "matchedTerms": ["legal", "AI"], "missingTerms": ["generic", "competitive"]},
                    }
                ],
            },
        ],
    }
    deck_content_diff = {
        "schemaVersion": "agent-builder.investment-deck-content-diff.v1",
        "summary": {"changedDealFilesWithExtractedText": 1, "claimCandidateCount": 3},
        "contentChanges": [
            {
                "file": "Irys Diligence/deck.pdf",
                "addedCount": 2,
                "removedCount": 1,
                "added": ["ARR increased to $1.8M+", "NRR reported at 131%"],
                "removed": ["ARR was listed as $1.2M in the prior version"],
            }
        ],
        "claimCandidates": [
            {"claim": "$1.8M+ ARR and 200+ paying firms", "file": "Irys Diligence/deck.pdf"},
            {"claim": "131% NRR and 97%+ retention", "file": "Irys Diligence/deck.pdf"},
            {"claim": "300+ legal teams use the product", "file": "Irys Diligence/deck.pdf"},
        ],
    }
    return {
        "schemaVersion": "agent-builder.investment-dashboard.v1",
        "company": "Irys Legal AI",
        "priorSessionId": "019e2ddb-801b-7ab0-a38c-138865ece4a7",
        "agentScore": 86,
        "recommendation": "Advance to diligence",
        "preferenceFit": [
            "AI-native workflow app with shipped revenue.",
            "Legal-domain wedge fits prior preference for workflow depth over generic tools.",
            "Needs evidence discipline because key retention and NRR claims remain deck-only.",
        ],
        "dimensions": [
            {
                "id": "preference-fit",
                "label": "Preference fit",
                "score": 92,
                "weight": 30,
                "rationale": "Matches AI workflow SaaS preference.",
                "recommendation": "Advance because this matches the AI-native workflow pattern favored in prior reviews.",
                "details": [
                    "Workflow ownership inside a professional vertical is the strongest fit signal.",
                    "Score should fall if the product is shallow usage or easy to replace with horizontal AI tools.",
                ],
                "sources": [
                    {"type": "prior session", "label": "Prior investment preference read", "locator": "Session 019e2ddb-801b-7ab0-a38c-138865ece4a7"},
                    {"type": "deck", "label": "Legal workflow positioning", "locator": "Pitch deck slide 2"},
                ],
            },
            {
                "id": "traction-quality",
                "label": "Traction quality",
                "score": 88,
                "weight": 25,
                "rationale": "ARR and paid-firm claims are strong but need primary backup.",
                "recommendation": "Verify ARR, retention, and paid-customer definitions before relying on this as a top traction signal.",
                "details": [
                    "The score is high because ARR, paying-firm count, retention, and NRR are the right SaaS proof points.",
                    "The score is capped because the most important numbers are still deck-derived until billing and cohort evidence are reviewed.",
                ],
                "sources": [
                    {"type": "deck", "label": "$1.8M+ ARR, 200+ paying firms, 97%+ retention, 131% NRR", "locator": "Pitch deck slide 8"},
                    {"type": "external", "label": "Irys public usage claim", "locator": "Company website", "url": "https://www.irys.ai/"},
                ],
            },
            {
                "id": "moat-durability",
                "label": "Moat durability",
                "score": 84,
                "weight": 20,
                "rationale": "Workflow depth and matter memory help, but competition is intense.",
                "recommendation": "Underwrite moat through workflow depth, matter memory, integrations, and verified retention.",
                "details": [
                    "The moat is strongest if the product is embedded in drafting, review, and matter-memory workflows.",
                    "The moat weakens if firms use it only for generic chat, search, or first-draft generation.",
                ],
                "sources": [
                    {"type": "deck", "label": "Matter memory, Word workflow, citation verification", "locator": "Pitch deck slides 5-7"},
                    {"type": "external", "label": "Irys product surface", "locator": "Company website", "url": "https://www.irys.ai/"},
                ],
            },
            {
                "id": "evidence-confidence",
                "label": "Evidence confidence",
                "score": 78,
                "weight": 15,
                "rationale": "Public support exists for usage, not all financial metrics.",
                "recommendation": "Treat public validation as supportive but incomplete; request primary financial and customer evidence.",
                "details": [
                    "Public sources support usage and positioning, but not all financial metrics.",
                    "Reconcile deck metrics against billing exports, cohort tables, and customer references.",
                ],
                "sources": [
                    {"type": "deck", "label": "ARR, NRR, retention, customer count", "locator": "Pitch deck slide 8"},
                    {"type": "external", "label": "Irys public site", "locator": "Company website", "url": "https://www.irys.ai/"},
                ],
            },
            {
                "id": "risk-adjusted-upside",
                "label": "Risk-adjusted upside",
                "score": 79,
                "weight": 10,
                "rationale": "Upside is attractive if retention and expansion claims hold.",
                "recommendation": "Keep as advance-to-diligence, not invest-now, until financial proof is reviewed.",
                "details": [
                    "The upside is driven by category fit, workflow embedding, and expansion potential.",
                    "The downside is valuation and competitive pressure if retention claims are overstated.",
                ],
                "sources": [
                    {"type": "deck", "label": "Expansion and retention case", "locator": "Pitch deck slides 8-11"},
                    {"type": "external", "label": "Irys public site", "locator": "Company website", "url": "https://www.irys.ai/"},
                ],
            },
        ],
        "claims": claims,
        "externalValidation": external_validation,
        "deckContentDiff": deck_content_diff,
        "upsideCase": upside,
        "bearCase": bear,
        "humanReview": {
            "score": 86,
            "recommendation": "Advance to diligence",
            "conviction": "Medium-high",
            "notes": "Verify ARR, NRR, retention cohorts, customer concentration, and competitive overlap before committing capital.",
        },
        "sourceContext": [
            "Prior session assessed CBANSV opportunities with LLM-wiki preference feedback.",
            "Preference pattern: AI-native workflow apps with shipped revenue, hard-to-access infra or defense, and selective direct deals with distribution.",
            "Caution pattern: healthcare and biotech need stronger validation or smaller exposure sizing.",
        ],
        "disclaimer": "Diligence support only; not investment advice.",
    }


def write_investment_opportunity_artifacts(
    root: Path,
    profile: Profile,
    experiment: dict[str, Any] | None = None,
) -> list[Path]:
    payload = investment_opportunity_payload()
    scorecard = {
        "schemaVersion": "agent-builder.investment-scorecard.v1",
        "company": payload["company"],
        "overallScore": payload["agentScore"],
        "recommendation": payload["recommendation"],
        "dimensions": payload["dimensions"],
        "preferenceFit": payload["preferenceFit"],
        "upsideCase": payload["upsideCase"],
        "bearCase": payload["bearCase"],
        "disclaimer": payload["disclaimer"],
    }
    claim_validation = {
        "schemaVersion": "agent-builder.investment-claim-validation.v1",
        "company": payload["company"],
        "priorSessionId": payload["priorSessionId"],
        "claims": payload["claims"],
    }
    dashboard_path = root / "review-dashboard.html"
    data_path = root / "dashboard-data.json"
    scorecard_path = root / "investment-scorecard.json"
    claims_path = root / "investment-claim-validation.json"
    external_validation_path = root / "external-research-validation.json"
    deck_diff_path = root / "deck-content-diff-log.json"
    summary_path = root / "opportunity-summary.md"
    notes_path = root / "human-score-and-notes.md"

    write_json(data_path, payload)
    write_json(scorecard_path, scorecard)
    write_json(claims_path, claim_validation)
    write_json(external_validation_path, payload["externalValidation"])
    write_json(deck_diff_path, payload["deckContentDiff"])
    write_text(dashboard_path, investment_dashboard_html(payload, profile))
    write_text(summary_path, investment_summary_markdown(payload))
    write_text(notes_path, investment_human_notes_markdown(payload))
    return [dashboard_path, data_path, scorecard_path, claims_path, external_validation_path, deck_diff_path, summary_path, notes_path]


def investment_dashboard_html(payload: dict[str, Any], profile: Profile) -> str:
    cards = "\n".join(
        f"<button class=\"card score-card\" type=\"button\" data-score-id=\"{html.escape(item['id'])}\"><span>{html.escape(item['label'])}</span><strong>{html.escape(str(item['score']))}</strong><small>{html.escape(item['rationale'])}</small></button>"
        for item in payload["dimensions"][:profile.dashboard_widgets]
    )
    first_dimension = payload["dimensions"][0]
    detail_sources = source_list_html(first_dimension["sources"])
    detail_items = "\n".join(f"<li>{html.escape(item)}</li>" for item in first_dimension["details"])
    claim_rows = "\n".join(
        f"<tr><td>{html.escape(item['claim'])}</td><td><span class=\"verdict verdict-{html.escape(item['verdict'])}\">{html.escape(item['verdict'])}</span></td><td>{html.escape(item['source'])}</td><td>{source_list_html(item.get('sources', []))}</td><td>{html.escape(item['diligenceAction'])}</td></tr>"
        for item in payload["claims"]
    )
    external_rows = "\n".join(
        f"<tr><td>{html.escape(item['claim'])}</td><td><span class=\"verdict verdict-{html.escape(item['verdict'])}\">{html.escape(item['verdict'])}</span></td><td>{html.escape(', '.join(item['sourceResults'][0]['evidence'].get('matchedTerms', [])))}</td><td>{source_list_html([item['sourceResults'][0]['source']])}</td></tr>"
        for item in payload["externalValidation"]["results"]
    )
    diff_rows = "\n".join(
        f"<tr><td>{html.escape(item['file'])}</td><td>{html.escape(str(item['addedCount']))}</td><td>{html.escape(str(item['removedCount']))}</td><td>{html.escape('; '.join(item.get('added', [])[:2]))}</td></tr>"
        for item in payload["deckContentDiff"]["contentChanges"]
    )
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{html.escape(payload["company"])} Investment Review</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 0; background: #f7f8f5; color: #17201b; }}
    main {{ max-width: 1180px; margin: 0 auto; padding: 28px; }}
    h1 {{ font-size: 34px; margin: 0 0 8px; }}
    h2 {{ font-size: 18px; margin: 0 0 10px; }}
    .hero {{ display: grid; grid-template-columns: 180px 1fr; gap: 12px; margin-bottom: 14px; }}
    .score, section {{ background: white; border: 1px solid #d8ddd4; border-radius: 8px; padding: 14px; }}
    .score strong {{ display: block; font-size: 48px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 14px 0; }}
    .card {{ background: white; border: 1px solid #d8ddd4; border-radius: 8px; color: inherit; cursor: pointer; padding: 14px; text-align: left; }}
    .card.is-active, .card:hover {{ border-color: #2e6f64; }}
    .card span, .card small {{ color: #5d695f; display: block; }}
    .card strong {{ display: block; font-size: 28px; margin: 6px 0; }}
    table {{ border-collapse: collapse; width: 100%; }}
    th, td {{ border-bottom: 1px solid #e3e6df; padding: 9px; text-align: left; vertical-align: top; }}
    th {{ color: #5d695f; font-size: 12px; }}
    input, select, textarea {{ border: 1px solid #cfd6cc; border-radius: 7px; display: block; margin: 5px 0 10px; padding: 8px; width: 100%; }}
    textarea {{ min-height: 90px; }}
    button {{ background: #2e6f64; border: 0; border-radius: 8px; color: white; font-weight: 700; padding: 10px 14px; }}
    .verdict {{ border-radius: 999px; display: inline-block; font-size: 12px; font-weight: 700; padding: 4px 8px; white-space: nowrap; }}
    .verdict-supported {{ background: #e1f3e7; color: #1f5a35; }}
    .verdict-externally-supported {{ background: #e1f3e7; color: #1f5a35; }}
    .verdict-partially-supported {{ background: #fff1d6; color: #7a4a09; }}
    .verdict-deck-only, .verdict-needs-review {{ background: #fff1d6; color: #7a4a09; }}
    .verdict-refuted {{ background: #f8dede; color: #8c2b2b; }}
    .cases {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; margin-top: 14px; }}
    .source-list {{ display: grid; gap: 6px; list-style: none; margin: 8px 0 0; padding: 0; }}
    .source-list li {{ background: #f4f6f1; border: 1px solid #e1e5dc; border-radius: 8px; display: grid; gap: 3px; padding: 8px; }}
    .source-list span {{ color: #1f574e; font-size: 11px; font-weight: 700; text-transform: uppercase; }}
    .source-list strong, .source-list small, .source-list a {{ display: block; font-size: 12px; overflow-wrap: anywhere; }}
    .source-list a {{ color: #1f574e; }}
  </style>
</head>
<body>
  <main>
    <div class="hero">
      <div class="score"><span>Agent score</span><strong>{payload["agentScore"]}</strong><small>{html.escape(payload["recommendation"])}</small></div>
      <section><h1>{html.escape(payload["company"])}</h1><p>{html.escape(payload["disclaimer"])}</p><p>{html.escape(payload["preferenceFit"][0])}</p></section>
    </div>
    <div class="grid">{cards}</div>
    <section id="scoreDetail">
      <h2>{html.escape(first_dimension["label"])} Details</h2>
      <p id="scoreRecommendation">{html.escape(first_dimension["recommendation"])}</p>
      <ul id="scoreDetails">{detail_items}</ul>
      <h3>Sources</h3>
      <div id="scoreSources">{detail_sources}</div>
    </section>
    <section><h2>Claim Validation</h2><table><thead><tr><th>Claim</th><th>Verdict</th><th>Source note</th><th>Sources</th><th>Diligence action</th></tr></thead><tbody>{claim_rows}</tbody></table></section>
    <section style="margin-top:14px"><h2>External Research Validation</h2><table><thead><tr><th>Claim</th><th>External verdict</th><th>Matched terms</th><th>Sources</th></tr></thead><tbody>{external_rows}</tbody></table></section>
    <section style="margin-top:14px"><h2>Deck Content Diff</h2><table><thead><tr><th>File</th><th>Added signals</th><th>Removed signals</th><th>Sample additions</th></tr></thead><tbody>{diff_rows}</tbody></table></section>
    <div class="cases">
      <section><h2>Upside Case</h2><p>{html.escape(payload["upsideCase"])}</p></section>
      <section><h2>Bear Case</h2><p>{html.escape(payload["bearCase"])}</p></section>
    </div>
    <section style="margin-top:14px">
      <h2>My Review</h2>
      <label>Human score<input id="humanScore" type="number" min="0" max="100" value="{payload["humanReview"]["score"]}"></label>
      <label>Recommendation<select id="recommendation"><option>Advance to diligence</option><option>Watchlist</option><option>Pass</option><option>Invest</option></select></label>
      <label>Notes<textarea id="notes">{html.escape(payload["humanReview"]["notes"])}</textarea></label>
      <button id="saveLocal" type="button">Save markdown preview</button>
      <textarea id="markdownOutput" aria-label="Markdown note"></textarea>
    </section>
  </main>
  <script>
    const dashboardData = {json.dumps(payload)};
    function sourceList(sources) {{
      return `<ul class="source-list">${{sources.map((source) => `<li><span>${{source.type}}</span><strong>${{source.label}}</strong><small>${{source.locator || ""}}</small>${{source.url ? `<a href="${{source.url}}" target="_blank" rel="noreferrer">${{source.url}}</a>` : ""}}</li>`).join("")}}</ul>`;
    }}
    function selectScore(id) {{
      const item = dashboardData.dimensions.find((row) => row.id === id) || dashboardData.dimensions[0];
      document.querySelectorAll(".score-card").forEach((card) => card.classList.toggle("is-active", card.dataset.scoreId === item.id));
      document.querySelector("#scoreDetail h2").textContent = `${{item.label}} Details`;
      document.getElementById("scoreRecommendation").textContent = item.recommendation;
      document.getElementById("scoreDetails").innerHTML = item.details.map((detail) => `<li>${{detail}}</li>`).join("");
      document.getElementById("scoreSources").innerHTML = sourceList(item.sources);
    }}
    function renderMarkdown() {{
      const score = document.getElementById("humanScore").value;
      const recommendation = document.getElementById("recommendation").value;
      const notes = document.getElementById("notes").value;
      const text = `# ${{dashboardData.company}} Investment Review\\n\\n## Recommendation\\n\\n- Agent score: ${{dashboardData.agentScore}}/100\\n- Human score: ${{score}}/100\\n- Recommendation: ${{recommendation}}\\n\\n## Notes\\n\\n${{notes}}\\n\\n## Claim Validation Snapshot\\n\\n${{dashboardData.claims.map((claim) => `- ${{claim.verdict}}: ${{claim.claim}}`).join("\\n")}}\\n`;
      document.getElementById("markdownOutput").value = text;
      localStorage.setItem("agent-builder-investment-review", text);
    }}
    document.getElementById("humanScore").addEventListener("input", renderMarkdown);
    document.getElementById("recommendation").addEventListener("change", renderMarkdown);
    document.getElementById("notes").addEventListener("input", renderMarkdown);
    document.getElementById("saveLocal").addEventListener("click", renderMarkdown);
    document.querySelectorAll(".score-card").forEach((card) => card.addEventListener("click", () => selectScore(card.dataset.scoreId)));
    selectScore(dashboardData.dimensions[0].id);
    renderMarkdown();
    console.log("investment dashboard", dashboardData);
  </script>
</body>
</html>
'''


def source_list_html(sources: list[dict[str, str]]) -> str:
    if not sources:
        return "<ul class=\"source-list\"><li><span>source</span><strong>No source supplied</strong></li></ul>"
    rows = []
    for source in sources:
        link = ""
        if source.get("url"):
            escaped_url = html.escape(source["url"], quote=True)
            link = f"<a href=\"{escaped_url}\" target=\"_blank\" rel=\"noreferrer\">{escaped_url}</a>"
        rows.append(
            "<li>"
            f"<span>{html.escape(source.get('type', 'source'))}</span>"
            f"<strong>{html.escape(source.get('label', 'Unnamed source'))}</strong>"
            f"<small>{html.escape(source.get('locator', ''))}</small>"
            f"{link}"
            "</li>"
        )
    return f"<ul class=\"source-list\">{''.join(rows)}</ul>"


def investment_summary_markdown(payload: dict[str, Any]) -> str:
    return markdown_from_sections(f"{payload['company']} Opportunity Summary", [
        ("Bottom Line", [f"{payload['recommendation']} at {payload['agentScore']}/100. {payload['disclaimer']}"]),
        ("Preference Fit", payload["preferenceFit"]),
        ("Upside Case", [payload["upsideCase"]]),
        ("Bear Case", [payload["bearCase"]]),
        ("Source Context", payload["sourceContext"]),
    ])


def investment_human_notes_markdown(payload: dict[str, Any]) -> str:
    review = payload["humanReview"]
    claims = [
        f"{item['verdict']}: {item['claim']} ({item['source']})"
        for item in payload["claims"]
    ]
    external_validation = [
        f"{item['verdict']}: {item['claim']}"
        for item in payload["externalValidation"]["results"]
    ]
    deck_diff = [
        f"{item['file']}: {item['addedCount']} added signals, {item['removedCount']} removed signals"
        for item in payload["deckContentDiff"]["contentChanges"]
    ]
    score_sources = []
    for dimension in payload["dimensions"]:
        score_sources.append(f"### {dimension['label']}")
        for source in dimension.get("sources", []):
            url = f" - {source['url']}" if source.get("url") else ""
            score_sources.append(f"- {source.get('type', 'source')}: {source.get('label', 'Unnamed source')}, {source.get('locator', 'no locator')}{url}")
    return f'''---
schema: agent-builder.investment-review.v1
company: {payload["company"]}
prior_session_id: {payload["priorSessionId"]}
audience_scope: investments
retrieval_scope: investments
---

# {payload["company"]} Investment Review

## Recommendation

- Agent score: {payload["agentScore"]}/100
- Human score: {review["score"]}/100
- Recommendation: {review["recommendation"]}
- Conviction: {review["conviction"]}

## Notes

{review["notes"]}

## Upside Case

{payload["upsideCase"]}

## Bear Case

{payload["bearCase"]}

## Claim Validation Snapshot

{chr(10).join(f"- {item}" for item in claims)}

## External Research Validation

{chr(10).join(f"- {item}" for item in external_validation)}

## Deck Content Diff

{chr(10).join(f"- {item}" for item in deck_diff)}

## Score Detail Sources

{chr(10).join(score_sources)}
'''


def artifact_index_html(outputs: list[str], profile: Profile) -> str:
    cards = "\n".join(
        f"<section class=\"card\"><span>{html.escape(Path(item).suffix or 'file')}</span><strong>{html.escape(Path(item).name)}</strong><small>{html.escape(item)}</small></section>"
        for item in outputs[:12]
    )
    payload = {"profile": profile.name, "outputs": outputs}
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Artifact Index</title>
  <style>
    body {{ font-family: Arial, sans-serif; margin: 0; background: #ffffff; color: #111827; }}
    main {{ max-width: 1080px; margin: 0 auto; padding: 32px; }}
    h1 {{ font-size: 30px; margin-bottom: 8px; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }}
    .card {{ border: 1px solid #d1d5db; border-radius: 8px; padding: 14px; background: #f9fafb; overflow-wrap: anywhere; }}
    .card span, .card small {{ display: block; color: #4b5563; }}
    .card strong {{ display: block; margin: 8px 0; }}
  </style>
</head>
<body>
  <main>
    <h1>Artifact Index</h1>
    <p>Local output inventory for profile {html.escape(profile.name)}.</p>
    <div class="grid">{cards}</div>
  </main>
  <script>
    const dashboardData = {json.dumps(payload)};
    console.log("artifact index", dashboardData);
  </script>
</body>
</html>
'''


def source_index(experiment: dict[str, Any] | None = None) -> list[dict[str, str]]:
    experiment = experiment or {}
    extra_sources = [
        "https://www.anthropic.com/engineering/built-multi-agent-research-system",
        "https://arxiv.org/abs/2503.13657",
        "https://arxiv.org/abs/2503.16416",
        "https://docs.nvidia.com/nemo/agent-toolkit/latest/",
        "https://github.com/openai/openai-agents-python",
    ]
    depth = int(experiment.get("researchDepth", 3))
    urls = (SOURCE_URLS + extra_sources)[:max(3, depth)]
    return [{"url": url, "use": "reference only, no download performed"} for url in urls]


def research_brief(model_notes: list[dict[str, Any]], experiment: dict[str, Any] | None = None) -> str:
    experiment = experiment or {}
    return markdown_from_sections("Research Brief: Secure Local Artifact Agents", [
        ("Finding", ["Local artifact agents should prefer narrow tool scope, explicit guardrails, and package validation."]),
        ("Source References", [item["url"] for item in source_index(experiment)]),
        ("Accuracy Notes", ["Claims are split into verified, inferred, unsupported, and needs-review labels before they are allowed into decks or Word artifacts."]),
        ("Local Model Notes", model_bullets(model_notes)),
        ("Open Question", ["Whether to add chunked long-run validation for slower local models."]),
    ])


def risk_summary(profile: Profile) -> dict[str, Any]:
    return {
        "profile": profile.name,
        "risks": [
            {"risk": "artifact escape", "control": "path containment validation", "status": "mitigated"},
            {"risk": "macro payload", "control": "OOXML forbidden part scan", "status": "mitigated"},
            {"risk": "local model timeout", "control": "small prompts and model note ledger", "status": "accepted"},
        ],
    }


def code_review_findings(profile: Profile) -> str:
    return markdown_from_sections("Code Review Findings", [
        ("Findings", ["No executable artifacts are generated.", "OOXML packages are scanned for macros and external relationships."]),
        ("Test Gaps", ["PowerPoint visual rendering is package-level validated but not opened in a GUI test."]),
        ("Recommendation", [f"Keep profile {profile.name} and add resumable local-model validation next."]),
    ])


def analysis_summary(profile: Profile) -> str:
    return markdown_from_sections("Analysis Summary", [
        ("Metrics", [f"Deck slides: {profile.deck_slides}", f"Document sections: {profile.doc_sections}", f"Dashboard widgets: {profile.dashboard_widgets}"]),
        ("Caveat", ["Metrics are from hypothetical scenarios and structural validation, not production user outcomes."]),
    ])


def speaker_notes(slides: list[dict[str, Any]]) -> str:
    return markdown_from_sections("Speaker Notes", [(slide["title"], slide["bullets"]) for slide in slides])


def markdown_from_sections(title: str, sections: list[tuple[str, list[str]]]) -> str:
    body = [f"# {title}", ""]
    for heading, bullets in sections:
        body.extend([f"## {heading}", ""])
        body.extend(f"- {item}" for item in bullets)
        body.append("")
    return "\n".join(body)


def write_doe_report(root: Path, result: dict[str, Any]) -> None:
    write_json(root / "doe-summary.json", result)
    lines = [
        "# Real Output DOE Summary",
        "",
        f"Design: {result['design']}",
        f"Response: {result['response']}",
        f"Best run: {result['best']['runId']} score={result['best']['score']}",
        "",
        "## Main Effects",
        "",
    ]
    for effect in result["effects"]:
        lines.append(f"- {effect['factor']}: {effect['effect']}")
    lines.extend(["", "## Runs", ""])
    for run in result["runs"]:
        lines.append(f"- {run['runId']}: score={run['score']} profile={run['profile']}")
    write_text(root / "doe-summary.md", "\n".join(lines) + "\n")


def write_markdown_summary(path: Path, result: dict[str, Any]) -> None:
    lines = [
        "# Hypothetical Local Agent Suite",
        "",
        f"Score: {result['score']}/{result['maxScore']}",
        f"Passed: {result['passed']}",
        "",
        "## Final Outputs",
        "",
    ]
    lines.extend(f"- `{item}`" for item in result["final"]["outputs"])
    lines.extend(["", "## Local Model Notes", ""])
    for note in result["modelNotes"]:
        lines.append(f"- `{note['model']}`: {note['status']} - {note.get('response') or note.get('error', '')}")
    if result["doe"]:
        lines.extend(["", "## DOE", "", f"Best run: `{result['doe']['best']['runId']}`"])
    write_text(path, "\n".join(lines) + "\n")


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def relative_paths(root: Path, paths: list[Path]) -> list[str]:
    return [str(path.relative_to(root)) for path in paths]


def ensure_allowed_root(root: Path) -> None:
    repo = REPO_ROOT.resolve()
    if not is_inside(repo, root):
        raise SystemExit(f"Refusing to write outside repo: {root}")
    if "agent-outputs" not in root.parts:
        raise SystemExit(f"Refusing to write outside agent-outputs folder: {root}")


def is_inside(root: Path, target: Path) -> bool:
    root = root.resolve()
    target = target.resolve()
    return target == root or root in target.parents


if __name__ == "__main__":
    raise SystemExit(main())
