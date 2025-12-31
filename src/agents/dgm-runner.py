#!/usr/bin/env python3
"""
DGM Runner - Darwin Gödel Machine Self-Improvement

Generates code improvement suggestions using LLM-based analysis.
Implements safe, bounded self-modification for agent code.

Usage:
    python dgm-runner.py --mode suggest --context '{...}'
    python dgm-runner.py --mode evaluate --code '...' --criteria '...'
"""

import argparse
import json
import os
import re
import sys
from typing import Any


def analyze_code(code: str) -> dict:
    """Analyze code structure and identify improvement opportunities."""
    analysis = {
        "lines": len(code.split("\n")),
        "functions": len(re.findall(r"(function|const|async function)\s+\w+\s*[(<]", code)),
        "classes": len(re.findall(r"class\s+\w+", code)),
        "error_handling": "try" in code and "catch" in code,
        "type_annotations": ": string" in code or ": number" in code,
        "comments": code.count("//") + code.count("/*"),
        "todos": code.lower().count("todo") + code.lower().count("fixme"),
    }

    # Identify improvement opportunities
    opportunities = []

    if not analysis["error_handling"]:
        opportunities.append("Add error handling with try/catch blocks")

    if analysis["todos"] > 0:
        opportunities.append(f"Address {analysis['todos']} TODO/FIXME comments")

    if analysis["comments"] < analysis["lines"] / 20:
        opportunities.append("Add more documentation comments")

    if not analysis["type_annotations"]:
        opportunities.append("Add TypeScript type annotations")

    # Check for common patterns to improve
    if "console.log" in code:
        opportunities.append("Replace console.log with proper logging")

    if "any" in code and "TypeScript" in code:
        opportunities.append("Replace 'any' types with specific types")

    if "== " in code or " ==" in code:
        opportunities.append("Use strict equality (===) instead of loose equality (==)")

    return {
        "analysis": analysis,
        "opportunities": opportunities,
    }


def generate_improvement(context: dict) -> dict:
    """Generate an improvement suggestion based on context."""
    code = context.get("code", "")
    objective = context.get("objective", "")
    criteria = context.get("evaluation_criteria", "")
    previous = context.get("previous_attempts", [])

    # Analyze current code
    analysis = analyze_code(code)

    # Filter out already attempted improvements
    attempted = {p.get("description", "") for p in previous if not p.get("accepted", True)}

    available_improvements = [
        opp for opp in analysis["opportunities"]
        if not any(attempted_desc.lower() in opp.lower() for attempted_desc in attempted)
    ]

    if not available_improvements:
        return {"improved_code": None, "description": None, "lines_changed": 0}

    # Select best improvement based on objective
    improvement = available_improvements[0]
    for opp in available_improvements:
        if any(word in opp.lower() for word in objective.lower().split()):
            improvement = opp
            break

    # Apply improvement (simplified - real implementation would use LLM)
    improved_code = code
    lines_changed = 0

    if "error handling" in improvement.lower():
        # Wrap main function in try/catch
        if "async function" in code:
            improved_code = re.sub(
                r"(async function \w+\([^)]*\)\s*{)",
                r"\1\n  try {",
                code,
                count=1
            )
            # Find matching closing brace and add catch
            improved_code = improved_code.rstrip()
            if improved_code.endswith("}"):
                improved_code = improved_code[:-1] + "\n  } catch (error) {\n    console.error('Error:', error);\n    throw error;\n  }\n}"
            lines_changed = 5

    elif "console.log" in improvement.lower():
        # Replace console.log with structured logging
        improved_code = code.replace("console.log(", "logger.info(")
        lines_changed = code.count("console.log(")

    elif "strict equality" in improvement.lower():
        # Replace == with ===
        improved_code = re.sub(r"([^=!])== ", r"\1=== ", code)
        improved_code = re.sub(r" ==([^=])", r" ===\1", improved_code)
        lines_changed = code.count("== ") + code.count(" ==") - (improved_code.count("== ") + improved_code.count(" =="))

    elif "documentation" in improvement.lower():
        # Add basic function documentation
        lines = improved_code.split("\n")
        new_lines = []
        for i, line in enumerate(lines):
            if re.match(r"\s*(export\s+)?(async\s+)?function\s+\w+", line):
                # Add JSDoc before function
                indent = len(line) - len(line.lstrip())
                doc = " " * indent + "/**\n"
                doc += " " * indent + " * TODO: Add function description\n"
                doc += " " * indent + " */\n"
                new_lines.append(doc)
                lines_changed += 3
            new_lines.append(line)
        improved_code = "\n".join(new_lines)

    elif "type annotations" in improvement.lower():
        # Add basic type annotations
        improved_code = re.sub(
            r"(const|let)\s+(\w+)\s*=\s*(\d+)",
            r"\1 \2: number = \3",
            code
        )
        improved_code = re.sub(
            r'(const|let)\s+(\w+)\s*=\s*"',
            r'\1 \2: string = "',
            improved_code
        )
        lines_changed = len(re.findall(r"(const|let)\s+\w+\s*=\s*(\d+|\")", code))

    return {
        "improved_code": improved_code if improved_code != code else None,
        "description": improvement,
        "lines_changed": lines_changed,
    }


def evaluate_code(code: str, criteria: str) -> dict:
    """Evaluate code against criteria."""
    analysis = analyze_code(code)

    score = 0.5  # Base score

    # Structural quality
    if analysis["analysis"]["error_handling"]:
        score += 0.1
    if analysis["analysis"]["type_annotations"]:
        score += 0.1
    if analysis["analysis"]["comments"] > 5:
        score += 0.05
    if analysis["analysis"]["todos"] == 0:
        score += 0.05

    # Criteria matching
    criteria_words = criteria.lower().split()
    code_lower = code.lower()
    matches = sum(1 for word in criteria_words if word in code_lower)
    score += min(0.2, matches * 0.02)

    return {
        "score": min(score, 1.0),
        "analysis": analysis["analysis"],
        "opportunities": analysis["opportunities"],
    }


def main():
    parser = argparse.ArgumentParser(description="DGM Runner")
    parser.add_argument("--mode", choices=["suggest", "evaluate", "analyze"], default="analyze")
    parser.add_argument("--context", type=str, help="JSON context for suggestion")
    parser.add_argument("--code", type=str, help="Code to evaluate")
    parser.add_argument("--criteria", type=str, help="Evaluation criteria")

    args = parser.parse_args()

    if args.mode == "suggest":
        if not args.context:
            print(json.dumps({"error": "Context required"}))
            return

        context = json.loads(args.context)
        result = generate_improvement(context)
        print(json.dumps(result))

    elif args.mode == "evaluate":
        if not args.code or not args.criteria:
            print(json.dumps({"error": "Code and criteria required"}))
            return

        result = evaluate_code(args.code, args.criteria)
        print(json.dumps(result))

    elif args.mode == "analyze":
        if not args.code:
            # Read from stdin
            code = sys.stdin.read()
        else:
            code = args.code

        result = analyze_code(code)
        print(json.dumps(result))


if __name__ == "__main__":
    main()
