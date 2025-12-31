#!/usr/bin/env python3
"""
GEPA Runner - Prompt Optimization via Reflective Text Evolution
Integrates with Discord bot's agent system for self-improving prompts.

Usage:
    python gepa-runner.py --mode optimize --prompt "..." --metric accuracy
    python gepa-runner.py --mode evaluate --prompt "..." --examples '[...]'
"""

import argparse
import json
import os
import sys
from typing import Any

# Check for GEPA installation
try:
    import gepa
    from gepa.core.adapter import GEPAAdapter
    GEPA_AVAILABLE = True
except ImportError:
    GEPA_AVAILABLE = False


def create_agent_adapter(agent_type: str = "default"):
    """Create a GEPA adapter for agent prompt optimization."""

    class AgentPromptAdapter(GEPAAdapter if GEPA_AVAILABLE else object):
        """Custom adapter for optimizing agent system prompts."""

        def __init__(self, agent_type: str):
            self.agent_type = agent_type
            self.execution_traces = []

        def evaluate(self, candidate: dict, minibatch: list) -> tuple[list[float], list[dict]]:
            """
            Evaluate a candidate prompt on a minibatch of examples.
            Returns scores and execution traces.
            """
            scores = []
            traces = []

            system_prompt = candidate.get("system_prompt", "")

            for example in minibatch:
                # Simulate evaluation (in production, this calls the actual agent)
                trace = {
                    "input": example.get("input", ""),
                    "expected": example.get("expected", ""),
                    "system_prompt": system_prompt,
                    "output": None,
                    "score": 0.0,
                }

                # Score based on prompt quality heuristics
                score = self._score_prompt(system_prompt, example)
                trace["score"] = score

                scores.append(score)
                traces.append(trace)

            self.execution_traces = traces
            return scores, traces

        def extract_traces_for_reflection(self, traces: list, component_name: str) -> str:
            """Extract relevant trace content for LLM reflection."""
            relevant = []
            for trace in traces:
                if trace.get("score", 0) < 0.8:  # Focus on failures
                    relevant.append(f"""
Input: {trace.get('input', '')}
Expected: {trace.get('expected', '')}
Score: {trace.get('score', 0):.2f}
System Prompt Used: {trace.get('system_prompt', '')[:200]}...
""")
            return "\n---\n".join(relevant) if relevant else "All examples passed."

        def _score_prompt(self, prompt: str, example: dict) -> float:
            """Heuristic scoring for prompt quality."""
            score = 0.5  # Base score

            # Check for key elements
            if len(prompt) > 50:
                score += 0.1
            if "step" in prompt.lower() or "first" in prompt.lower():
                score += 0.1  # Has structure
            if "example" in prompt.lower():
                score += 0.1  # Has examples
            if example.get("keywords"):
                for kw in example["keywords"]:
                    if kw.lower() in prompt.lower():
                        score += 0.05

            return min(score, 1.0)

    return AgentPromptAdapter(agent_type)


def optimize_prompt(
    seed_prompt: str,
    examples: list[dict],
    task_model: str = "openai/gpt-4.1-mini",
    reflection_model: str = "openai/gpt-4.1-mini",
    max_iterations: int = 50,
    agent_type: str = "default",
) -> dict:
    """
    Optimize an agent prompt using GEPA.

    Args:
        seed_prompt: Initial system prompt to optimize
        examples: Training examples with input/expected pairs
        task_model: Model for task execution
        reflection_model: Model for reflection and mutation
        max_iterations: Maximum optimization steps
        agent_type: Type of agent (default, coding, trading, etc.)

    Returns:
        Optimization result with best prompt and metrics
    """
    if not GEPA_AVAILABLE:
        return {
            "success": False,
            "error": "GEPA not installed. Run: pip install gepa",
            "original_prompt": seed_prompt,
        }

    try:
        # Split examples into train/val
        split_idx = max(1, len(examples) * 3 // 4)
        trainset = examples[:split_idx]
        valset = examples[split_idx:] if split_idx < len(examples) else examples[:1]

        # Create adapter
        adapter = create_agent_adapter(agent_type)

        # Run GEPA optimization
        result = gepa.optimize(
            seed_candidate={"system_prompt": seed_prompt},
            trainset=trainset,
            valset=valset,
            task_lm=task_model,
            reflection_lm=reflection_model,
            max_metric_calls=max_iterations,
            adapter=adapter,
        )

        return {
            "success": True,
            "original_prompt": seed_prompt,
            "optimized_prompt": result.best_candidate.get("system_prompt", seed_prompt),
            "improvement": result.best_score - result.initial_score if hasattr(result, 'initial_score') else 0,
            "best_score": result.best_score if hasattr(result, 'best_score') else None,
            "iterations": result.num_iterations if hasattr(result, 'num_iterations') else max_iterations,
            "history": result.history if hasattr(result, 'history') else [],
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "original_prompt": seed_prompt,
        }


def evaluate_prompt(
    prompt: str,
    examples: list[dict],
    agent_type: str = "default",
) -> dict:
    """
    Evaluate a prompt against examples without optimization.

    Args:
        prompt: System prompt to evaluate
        examples: Test examples with input/expected pairs
        agent_type: Type of agent

    Returns:
        Evaluation metrics
    """
    adapter = create_agent_adapter(agent_type)

    try:
        scores, traces = adapter.evaluate({"system_prompt": prompt}, examples)

        return {
            "success": True,
            "prompt": prompt,
            "avg_score": sum(scores) / len(scores) if scores else 0,
            "min_score": min(scores) if scores else 0,
            "max_score": max(scores) if scores else 0,
            "num_examples": len(examples),
            "passing": sum(1 for s in scores if s >= 0.8),
            "failing": sum(1 for s in scores if s < 0.8),
            "traces": traces,
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "prompt": prompt,
        }


def load_expertise_prompts(expertise_dir: str) -> dict[str, str]:
    """Load existing expertise prompts from markdown files."""
    prompts = {}

    if not os.path.exists(expertise_dir):
        return prompts

    for filename in os.listdir(expertise_dir):
        if filename.endswith(".md"):
            domain = filename[:-3]  # Remove .md
            filepath = os.path.join(expertise_dir, filename)
            with open(filepath, "r") as f:
                prompts[domain] = f.read()

    return prompts


def save_optimized_prompt(
    domain: str,
    prompt: str,
    expertise_dir: str,
    backup: bool = True,
) -> str:
    """Save optimized prompt to expertise file."""
    os.makedirs(expertise_dir, exist_ok=True)

    filepath = os.path.join(expertise_dir, f"{domain}.md")

    # Backup existing
    if backup and os.path.exists(filepath):
        backup_path = f"{filepath}.backup"
        with open(filepath, "r") as f:
            with open(backup_path, "w") as bf:
                bf.write(f.read())

    # Write optimized prompt
    with open(filepath, "w") as f:
        f.write(f"""# {domain.title()} Expert Prompt
# Optimized by GEPA - Reflective Text Evolution

{prompt}
""")

    return filepath


def main():
    parser = argparse.ArgumentParser(description="GEPA Prompt Optimization Runner")
    parser.add_argument("--mode", choices=["optimize", "evaluate", "status"], default="status")
    parser.add_argument("--prompt", type=str, help="Initial prompt to optimize")
    parser.add_argument("--examples", type=str, help="JSON array of examples")
    parser.add_argument("--examples-file", type=str, help="Path to examples JSON file")
    parser.add_argument("--agent-type", type=str, default="default", help="Agent type")
    parser.add_argument("--task-model", type=str, default="openai/gpt-4.1-mini")
    parser.add_argument("--reflection-model", type=str, default="openai/gpt-4.1-mini")
    parser.add_argument("--max-iterations", type=int, default=50)
    parser.add_argument("--expertise-dir", type=str, help="Path to expertise directory")
    parser.add_argument("--domain", type=str, help="Domain for saving optimized prompt")

    args = parser.parse_args()

    # Status check
    if args.mode == "status":
        result = {
            "gepa_available": GEPA_AVAILABLE,
            "gepa_version": gepa.__version__ if GEPA_AVAILABLE else None,
            "python_version": sys.version,
        }
        print(json.dumps(result))
        return

    # Load examples
    examples = []
    if args.examples:
        examples = json.loads(args.examples)
    elif args.examples_file:
        with open(args.examples_file, "r") as f:
            examples = json.load(f)

    if args.mode == "optimize":
        if not args.prompt:
            print(json.dumps({"error": "Prompt required for optimization"}))
            return

        result = optimize_prompt(
            seed_prompt=args.prompt,
            examples=examples,
            task_model=args.task_model,
            reflection_model=args.reflection_model,
            max_iterations=args.max_iterations,
            agent_type=args.agent_type,
        )

        # Save if domain specified
        if result.get("success") and args.domain and args.expertise_dir:
            filepath = save_optimized_prompt(
                args.domain,
                result["optimized_prompt"],
                args.expertise_dir,
            )
            result["saved_to"] = filepath

        print(json.dumps(result))

    elif args.mode == "evaluate":
        if not args.prompt:
            print(json.dumps({"error": "Prompt required for evaluation"}))
            return

        result = evaluate_prompt(
            prompt=args.prompt,
            examples=examples,
            agent_type=args.agent_type,
        )
        print(json.dumps(result))


if __name__ == "__main__":
    main()
