#!/usr/bin/env python3
"""
ARC-AGI DSPy Program Evolution via GEPA

Evolves optimal DSPy modules to solve ARC-AGI 2 tasks using:
- Gemini Flash 3 as student (task execution)
- Gemini 3 Pro as teacher (reflection/mutation)

Paper: GEPA - System Optimization Through Reflective Text Evolution
ARC-AGI: Abstraction and Reasoning Corpus for Artificial General Intelligence

Usage:
    python arc-agi-evolve.py --mode evolve --tasks 10 --iterations 100
    python arc-agi-evolve.py --mode evaluate --program "program.py"
    python arc-agi-evolve.py --mode benchmark
"""

import argparse
import json
import os
import sys
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable
import random
from pathlib import Path

# ============================================================================
# CONFIGURATION
# ============================================================================

# Model configuration for student-teacher paradigm
# Gemini models (requires GEMINI_API_KEY) - use gemini/ prefix
# OpenRouter models (requires OPENROUTER_API_KEY) - use openrouter/ prefix
# Z.ai GLM models (requires ZAI_API_KEY) - use zai/ prefix
# xAI Grok models (requires XAI_API_KEY) - use xai/ prefix
#
# Available configurations:
#   Gemini:     gemini/gemini-2.0-flash-exp, gemini/gemini-exp-1206
#   OpenRouter: openrouter/google/gemini-2.0-flash-exp:free, openrouter/google/gemini-exp-1206:free
#   Anthropic:  openrouter/anthropic/claude-3.5-sonnet, openrouter/anthropic/claude-3-opus
#   DeepSeek:   openrouter/deepseek/deepseek-chat, openrouter/deepseek/deepseek-chat-v3-0324
#   Z.ai GLM:   zai/glm-4.7, zai/glm-4.6 ($6/mo coding plan - 120 prompts/5hr)
#   xAI Grok:   xai/grok-code-fast-1, xai/grok-4, xai/grok-4.1-fast
#   OpenCode:   opencode/grok-code, opencode/gpt-4o, opencode/claude-sonnet
#   NVIDIA:     nvidia/moonshotai/kimi-k2-thinking, nvidia/deepseek-ai/deepseek-v3.1 (FREE)

# Default: Gemini 3 Flash Preview - fast and cheap
STUDENT_MODEL = "openrouter/google/gemini-3-flash-preview"     # Gemini 3 Flash - task execution
TEACHER_MODEL = "openrouter/google/gemini-3-flash-preview"     # Gemini 3 Flash - reflection

# ARC-AGI dataset source
ARC_REPO_BASE = "https://raw.githubusercontent.com/fchollet/ARC-AGI/master"
ARC_TRAINING_URL = f"{ARC_REPO_BASE}/data/training"
ARC_EVALUATION_URL = f"{ARC_REPO_BASE}/data/evaluation"

# Evolution parameters (aligned with GEPA paper)
DEFAULT_MAX_ITERATIONS = 100
DEFAULT_POPULATION_SIZE = 8
PARETO_SELECTION = True  # Use Pareto-aware selection

# Check for dependencies
try:
    import dspy
    DSPY_AVAILABLE = True
except ImportError:
    DSPY_AVAILABLE = False

try:
    from gepa import optimize
    from gepa.core.adapter import GEPAAdapter, EvaluationBatch
    GEPA_AVAILABLE = True
except ImportError:
    GEPA_AVAILABLE = False

# Custom DSPy adapter for ARC-AGI (compatible with DSPy 2.6+)
if GEPA_AVAILABLE and DSPY_AVAILABLE:
    from dataclasses import dataclass
    from typing import TypeVar, Generic, Tuple, Optional
    import threading

    Example = TypeVar('Example')
    TraceData = TypeVar('TraceData')
    Prediction = TypeVar('Prediction')

    @dataclass
    class ARCTrace:
        """Trace data for ARC-AGI execution."""
        input_grid: list
        expected_grid: list
        predicted_grid: Optional[list]
        score: float
        error: Optional[str] = None

    class ARCDspyAdapter(GEPAAdapter):
        """
        Custom DSPy adapter for ARC-AGI tasks.
        Compatible with DSPy 2.6+ (no bootstrap_trace dependency).
        """

        def __init__(
            self,
            task_lm: "dspy.LM",
            metric_fn,
            reflection_lm,
            failure_score: float = 0.0,
            num_threads: int = 4,
        ):
            self.task_lm = task_lm
            self.metric_fn = metric_fn
            self.reflection_lm = reflection_lm
            self.failure_score = failure_score
            self.num_threads = num_threads
            self._lock = threading.Lock()

        def build_program(self, candidate: dict) -> Tuple[Optional["dspy.Module"], Optional[str]]:
            """Build DSPy program from candidate code string."""
            code = candidate.get("program", "")

            try:
                # Use same dict for globals and locals so class definitions are available
                ns = {"dspy": dspy, "__builtins__": __builtins__}
                exec(code, ns, ns)
                program = ns.get("program")

                if program is None:
                    return None, "No 'program' variable found in code"

                return program, None
            except Exception as e:
                return None, f"Failed to build program: {e}"

        def evaluate(
            self,
            batch: list,
            candidate: dict,
            capture_traces: bool = False,
        ) -> "EvaluationBatch":
            """Evaluate candidate on a batch of examples."""
            scores = []
            outputs = []
            traces = []

            # Build program
            program, error = self.build_program(candidate)
            if error:
                # Return failure scores for all examples
                for _ in batch:
                    scores.append(self.failure_score)
                    outputs.append(None)
                    traces.append(ARCTrace(
                        input_grid=[], expected_grid=[], predicted_grid=None,
                        score=self.failure_score, error=error
                    ))
                return EvaluationBatch(
                    outputs=outputs,
                    scores=scores,
                    trajectories=traces if capture_traces else None
                )

            # Configure task LM
            with dspy.context(lm=self.task_lm):
                for example in batch:
                    try:
                        # Execute program
                        prediction = program(
                            train_examples=example.train_examples,
                            test_input=example.test_input,
                        )

                        # Score
                        score = self.metric_fn(example, prediction)
                        scores.append(score)

                        predicted_grid = getattr(prediction, 'output_grid', None)
                        outputs.append(predicted_grid)

                        traces.append(ARCTrace(
                            input_grid=example.test_input,
                            expected_grid=example.test_output,
                            predicted_grid=predicted_grid,
                            score=score,
                        ))

                    except Exception as e:
                        scores.append(self.failure_score)
                        outputs.append(None)
                        traces.append(ARCTrace(
                            input_grid=getattr(example, 'test_input', []),
                            expected_grid=getattr(example, 'test_output', []),
                            predicted_grid=None,
                            score=self.failure_score,
                            error=str(e),
                        ))

            return EvaluationBatch(
                outputs=outputs,
                scores=scores,
                trajectories=traces if capture_traces else None
            )

        def make_reflective_dataset(
            self,
            candidate: dict,
            eval_batch: "EvaluationBatch",
            components_to_update: list,
        ) -> dict:
            """
            Convert evaluation results to reflective dataset for mutation proposal.
            Returns dict: component_name -> list of reflective examples.
            """
            reflective_data = []

            if eval_batch.trajectories:
                for trace in eval_batch.trajectories:
                    if trace.score < 0.8:  # Focus on failures
                        reflective_data.append({
                            "Inputs": {
                                "test_input": str(trace.input_grid)[:200],
                                "expected_output": str(trace.expected_grid)[:200],
                            },
                            "Generated Outputs": str(trace.predicted_grid)[:200] if trace.predicted_grid else "None",
                            "Feedback": f"Score: {trace.score:.2f}. Error: {trace.error or 'Incorrect output'}",
                        })

            # Return for the "program" component (our single component)
            return {"program": reflective_data if reflective_data else [{"Inputs": {}, "Generated Outputs": "", "Feedback": "All passed"}]}

        def extract_traces_for_reflection(self, traces: list, component_name: str) -> str:
            """Extract trace information for LLM reflection."""
            failure_traces = []

            for i, trace in enumerate(traces):
                if trace.score < 0.5:  # Focus on failures
                    failure_traces.append(f"""
Example {i + 1}:
  Input Grid: {trace.input_grid}
  Expected Output: {trace.expected_grid}
  Predicted Output: {trace.predicted_grid}
  Score: {trace.score:.2f}
  Error: {trace.error or 'None'}
""")

            if not failure_traces:
                return "All examples passed successfully!"

            return f"""
The following {len(failure_traces)} examples failed:

{'---'.join(failure_traces)}

Please analyze the failures and propose improvements to the program.
Focus on:
1. Pattern recognition in input/output transformations
2. Grid manipulation logic
3. Edge cases in the transformation rules
"""

        def propose_new_texts(
            self,
            candidate: dict,
            reflective_dataset: dict,
            components_to_update: list,
        ) -> dict:
            """Use reflection LM to propose improved program."""
            current_program = candidate.get("program", "")

            # Build feedback from reflective dataset
            program_feedback = reflective_dataset.get("program", [])
            feedback_text = ""
            for item in program_feedback:
                inputs = item.get("Inputs", {})
                outputs = item.get("Generated Outputs", "")
                feedback = item.get("Feedback", "")
                feedback_text += f"""
Input: {inputs.get('test_input', 'N/A')}
Expected: {inputs.get('expected_output', 'N/A')}
Generated: {outputs}
Feedback: {feedback}
---
"""

            if not feedback_text:
                feedback_text = "All examples passed successfully!"

            reflection_prompt = f"""You are an expert at solving ARC-AGI abstract reasoning tasks using DSPy.

CURRENT PROGRAM:
```python
{current_program}
```

EVALUATION RESULTS:
{feedback_text}

Your task is to propose an IMPROVED version of the program that will achieve higher scores.

Key considerations for ARC-AGI:
1. Identify patterns in the training examples (scaling, rotation, reflection, color mapping)
2. Decompose complex transformations into simpler steps
3. Use appropriate DSPy signatures that capture the reasoning process
4. Handle edge cases in grid dimensions and colors

RESPOND WITH ONLY THE IMPROVED PYTHON CODE (no explanations):
"""

            try:
                response = self.reflection_lm(reflection_prompt)
                improved_code = response if isinstance(response, str) else response[0]

                # Clean up code (extract from markdown if needed)
                if "```python" in improved_code:
                    improved_code = improved_code.split("```python")[1].split("```")[0]
                elif "```" in improved_code:
                    improved_code = improved_code.split("```")[1].split("```")[0]

                # Return dict: component_name -> new text
                return {"program": improved_code.strip()}

            except Exception as e:
                print(f"Reflection failed: {e}", file=sys.stderr)
                return {}  # Return empty dict if reflection fails


# ============================================================================
# ARC-AGI DATA STRUCTURES
# ============================================================================

@dataclass
class ARCExample:
    """Single ARC input-output example."""
    input_grid: list[list[int]]
    output_grid: list[list[int]]


@dataclass
class ARCTask:
    """ARC task with train examples and test cases."""
    task_id: str
    train: list[ARCExample]
    test: list[ARCExample]

    def to_dspy_example(self) -> "dspy.Example":
        """Convert to DSPy Example format."""
        return dspy.Example(
            task_id=self.task_id,
            train_examples=[(e.input_grid, e.output_grid) for e in self.train],
            test_input=self.test[0].input_grid if self.test else None,
            test_output=self.test[0].output_grid if self.test else None,
        ).with_inputs("task_id", "train_examples", "test_input")


def fetch_arc_task(task_id: str, dataset: str = "training") -> ARCTask | None:
    """Fetch a single ARC task from GitHub."""
    base_url = ARC_TRAINING_URL if dataset == "training" else ARC_EVALUATION_URL
    url = f"{base_url}/{task_id}.json"

    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            data = json.loads(response.read().decode())

        train_examples = [
            ARCExample(input_grid=ex["input"], output_grid=ex["output"])
            for ex in data.get("train", [])
        ]
        test_examples = [
            ARCExample(input_grid=ex["input"], output_grid=ex["output"])
            for ex in data.get("test", [])
        ]

        return ARCTask(task_id=task_id, train=train_examples, test=test_examples)
    except Exception as e:
        print(f"Error fetching task {task_id}: {e}", file=sys.stderr)
        return None


def fetch_task_list(dataset: str = "training") -> list[str]:
    """Fetch list of available ARC task IDs."""
    # Known sample task IDs from ARC training set
    # In production, this would fetch the full list from GitHub
    sample_tasks = [
        "007bbfb7", "00d62c1b", "017c7c7b", "025d127b", "0520fde7",
        "05f2a901", "06df4c85", "08ed6ac7", "09629e4f", "0a938d79",
        "0b148d64", "0ca9ddb6", "0d3d703e", "0dfd9992", "0e206a2e",
        "10fcaaa3", "11852cab", "1190e5a7", "137eaa0f", "150deff5",
        "178fcbfb", "1a07d186", "1b2d62fb", "1b60fb0c", "1bfc4729",
        "1c786137", "1caeab9d", "1cf80156", "1e0a9b12", "1e32b0e9",
    ]
    return sample_tasks


# ============================================================================
# EVALUATION METRICS
# ============================================================================

def grid_exact_match(predicted: list[list[int]], expected: list[list[int]]) -> float:
    """
    Pixel-perfect grid matching (ARC-AGI requirement).
    Returns 1.0 for exact match, 0.0 otherwise.
    """
    if predicted is None or expected is None:
        return 0.0

    if len(predicted) != len(expected):
        return 0.0

    for row_pred, row_exp in zip(predicted, expected):
        if len(row_pred) != len(row_exp):
            return 0.0
        if row_pred != row_exp:
            return 0.0

    return 1.0


def grid_partial_match(predicted: list[list[int]], expected: list[list[int]]) -> float:
    """
    Partial grid matching for gradient signal during evolution.
    Returns percentage of correct cells.
    """
    if predicted is None or expected is None:
        return 0.0

    if len(predicted) != len(expected):
        # Penalize size mismatch but provide some signal
        return 0.0

    total_cells = 0
    correct_cells = 0

    for row_pred, row_exp in zip(predicted, expected):
        if len(row_pred) != len(row_exp):
            return 0.0

        for cell_pred, cell_exp in zip(row_pred, row_exp):
            total_cells += 1
            if cell_pred == cell_exp:
                correct_cells += 1

    return correct_cells / total_cells if total_cells > 0 else 0.0


def parse_grid_output(output) -> list[list[int]] | None:
    """Parse grid output from LLM (may be string or list)."""
    if output is None:
        return None

    # Already a list
    if isinstance(output, list):
        return output

    # String representation - try to parse
    if isinstance(output, str):
        try:
            import ast
            # Try direct eval of list representation
            parsed = ast.literal_eval(output.strip())
            if isinstance(parsed, list):
                return parsed
        except:
            pass

        # Try extracting from JSON-like format
        try:
            parsed = json.loads(output)
            if isinstance(parsed, list):
                return parsed
        except:
            pass

        # Try extracting grid from multiline string (e.g., "[[0, 1], [1, 0]]")
        import re
        match = re.search(r'\[\s*\[.*?\]\s*\]', output.replace('\n', ''), re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except:
                pass

    return None


def arc_metric(example: "dspy.Example", prediction: "dspy.Prediction", trace=None) -> float:
    """
    Combined ARC-AGI metric for GEPA evolution.

    Scoring:
    - Exact match: 1.0
    - Partial match: 0.0 to 0.9 (proportional to correct cells)
    - Wrong dimensions: 0.0
    """
    try:
        raw_output = prediction.output_grid if hasattr(prediction, 'output_grid') else None
        predicted = parse_grid_output(raw_output)
        expected = example.test_output

        # Exact match gets full score
        if grid_exact_match(predicted, expected) == 1.0:
            return 1.0

        # Partial credit for gradient signal during evolution
        partial = grid_partial_match(predicted, expected)
        return partial * 0.9  # Cap at 0.9 for partial matches

    except Exception:
        return 0.0


# ============================================================================
# SEED DSPy PROGRAMS
# ============================================================================

# Minimal seed program - starting point for evolution
SEED_PROGRAM_MINIMAL = '''
import dspy

class ARCSignature(dspy.Signature):
    """Solve ARC-AGI abstract reasoning task."""
    train_examples: list = dspy.InputField(desc="List of (input_grid, output_grid) training pairs")
    test_input: list = dspy.InputField(desc="Test input grid to transform")
    output_grid: list = dspy.OutputField(desc="Predicted output grid")

class ARCSolver(dspy.Module):
    def __init__(self):
        super().__init__()
        self.reasoner = dspy.ChainOfThought(ARCSignature)

    def forward(self, train_examples, test_input):
        return self.reasoner(train_examples=train_examples, test_input=test_input)

program = ARCSolver()
'''

# Enhanced seed with pattern analysis
SEED_PROGRAM_PATTERN = '''
import dspy

class AnalyzePatterns(dspy.Signature):
    """Analyze patterns in ARC training examples."""
    train_examples: list = dspy.InputField(desc="Training (input, output) grid pairs")
    patterns: str = dspy.OutputField(desc="Identified transformation patterns")

class ApplyPattern(dspy.Signature):
    """Apply identified patterns to solve ARC task."""
    patterns: str = dspy.InputField(desc="Transformation patterns discovered")
    test_input: list = dspy.InputField(desc="Test grid to transform")
    output_grid: list = dspy.OutputField(desc="Transformed output grid")

class ARCSolverWithPatterns(dspy.Module):
    def __init__(self):
        super().__init__()
        self.analyzer = dspy.ChainOfThought(AnalyzePatterns)
        self.applier = dspy.ChainOfThought(ApplyPattern)

    def forward(self, train_examples, test_input):
        patterns = self.analyzer(train_examples=train_examples).patterns
        return self.applier(patterns=patterns, test_input=test_input)

program = ARCSolverWithPatterns()
'''

# Advanced seed with multi-step reasoning
SEED_PROGRAM_ADVANCED = '''
import dspy

class IdentifyObjects(dspy.Signature):
    """Identify objects and their properties in ARC grids."""
    grid: list = dspy.InputField(desc="2D grid with integer color values")
    objects: str = dspy.OutputField(desc="JSON list of objects with positions, colors, shapes")

class FindTransformations(dspy.Signature):
    """Find transformations between input/output grids."""
    input_objects: str = dspy.InputField(desc="Objects in input grid")
    output_objects: str = dspy.InputField(desc="Objects in output grid")
    transformations: str = dspy.OutputField(desc="List of transformation rules")

class ApplyTransformations(dspy.Signature):
    """Apply transformation rules to produce output."""
    test_input: list = dspy.InputField(desc="Test input grid")
    transformations: str = dspy.InputField(desc="Transformation rules to apply")
    output_grid: list = dspy.OutputField(desc="Predicted output grid")

class ARCSolverAdvanced(dspy.Module):
    def __init__(self):
        super().__init__()
        self.identifier = dspy.ChainOfThought(IdentifyObjects)
        self.transformer = dspy.ChainOfThought(FindTransformations)
        self.applier = dspy.ChainOfThought(ApplyTransformations)

    def forward(self, train_examples, test_input):
        # Analyze each training example
        transformations = []
        for inp, out in train_examples:
            inp_objects = self.identifier(grid=inp).objects
            out_objects = self.identifier(grid=out).objects
            trans = self.transformer(
                input_objects=inp_objects,
                output_objects=out_objects
            ).transformations
            transformations.append(trans)

        # Combine and apply transformations
        combined = "\\n".join(transformations)
        return self.applier(test_input=test_input, transformations=combined)

program = ARCSolverAdvanced()
'''


# ============================================================================
# GEPA EVOLUTION
# ============================================================================

def configure_model(model_str: str) -> dict:
    """Configure model parameters based on provider prefix."""
    config = {"max_tokens": 4096, "temperature": 0.7}

    if model_str.startswith("zai/"):
        # Z.ai GLM models - use OpenAI-compatible coding plan endpoint ($6/mo)
        model_name = model_str.replace("zai/", "")  # glm-4.7, glm-4.6
        api_key = os.environ.get("ZAI_API_KEY")
        if not api_key:
            raise ValueError("ZAI_API_KEY environment variable not set")
        # Use openai/ with explicit api_base in config for LiteLLM
        config["model"] = f"openai/{model_name}"
        config["api_key"] = api_key
        config["api_base"] = "https://api.z.ai/api/coding/paas/v4"
        # GLM models need more tokens for verbose output
        # GLM-4.7 is reasoning model, GLM-4.6 is also verbose
        config["max_tokens"] = 8192
    elif model_str.startswith("xai/"):
        # xAI Grok models - OpenAI-compatible endpoint
        model_name = model_str.replace("xai/", "")
        api_key = os.environ.get("XAI_API_KEY")
        if not api_key:
            raise ValueError("XAI_API_KEY environment variable not set")
        # Set LiteLLM env vars for xAI (OpenAI-compatible API)
        os.environ["OPENAI_API_KEY"] = api_key
        os.environ["OPENAI_API_BASE"] = "https://api.x.ai/v1"
        config["model"] = f"openai/{model_name}"
    elif model_str.startswith("opencode/"):
        # OpenCode Zen models - OpenAI-compatible endpoint
        model_name = model_str.replace("opencode/", "")
        api_key = os.environ.get("OPENCODE_API_KEY")
        if not api_key:
            raise ValueError("OPENCODE_API_KEY environment variable not set")
        # Set LiteLLM env vars for OpenCode (OpenAI-compatible API)
        os.environ["OPENAI_API_KEY"] = api_key
        os.environ["OPENAI_API_BASE"] = "https://opencode.ai/zen/v1"
        config["model"] = f"openai/{model_name}"
    elif model_str.startswith("nvidia/"):
        # NVIDIA NIM models - OpenAI-compatible endpoint (FREE)
        model_name = model_str.replace("nvidia/", "")
        api_key = os.environ.get("NVIDIA_API_KEY")
        if not api_key:
            raise ValueError("NVIDIA_API_KEY environment variable not set. Get free key at https://build.nvidia.com")
        # Use nvidia_nim provider for proper routing
        config["model"] = f"nvidia_nim/{model_name}"
        config["api_key"] = api_key
    else:
        config["model"] = model_str

    return config


def create_arc_adapter(student_model: str, teacher_model: str):
    """Create GEPA adapter for ARC-AGI DSPy evolution."""
    if not GEPA_AVAILABLE or not DSPY_AVAILABLE:
        raise RuntimeError("GEPA and DSPy are required. Install with: pip install gepa dspy-ai")

    # Configure models based on provider
    student_config = configure_model(student_model)
    teacher_config = configure_model(teacher_model)
    teacher_config["max_tokens"] = 16384
    teacher_config["temperature"] = 0.3

    task_lm = dspy.LM(**student_config)
    reflection_lm = dspy.LM(**teacher_config)

    # Create custom ARCDspyAdapter for full program evolution (DSPy 2.6+ compatible)
    adapter = ARCDspyAdapter(
        task_lm=task_lm,
        metric_fn=arc_metric,
        reflection_lm=lambda x: reflection_lm(x)[0],
        failure_score=0.0,
        num_threads=4,
    )

    return adapter


def evolve_arc_solver(
    tasks: list[ARCTask],
    seed_program: str = SEED_PROGRAM_MINIMAL,
    student_model: str = STUDENT_MODEL,
    teacher_model: str = TEACHER_MODEL,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
    val_split: float = 0.2,
) -> dict:
    """
    Evolve optimal DSPy program for ARC-AGI solving.

    Args:
        tasks: List of ARC tasks for training/validation
        seed_program: Initial DSPy program code
        student_model: Model for task execution
        teacher_model: Model for reflection/mutation
        max_iterations: Maximum evolution iterations
        val_split: Validation set fraction

    Returns:
        Evolution results with best program and metrics
    """
    if not GEPA_AVAILABLE or not DSPY_AVAILABLE:
        return {
            "success": False,
            "error": "GEPA and DSPy required. Install: pip install gepa dspy-ai",
        }

    try:
        # Convert tasks to DSPy Examples
        examples = [task.to_dspy_example() for task in tasks]
        random.shuffle(examples)

        # Split train/val
        split_idx = max(1, int(len(examples) * (1 - val_split)))
        trainset = examples[:split_idx]
        valset = examples[split_idx:] if split_idx < len(examples) else examples[:1]

        print(f"Training set: {len(trainset)} tasks")
        print(f"Validation set: {len(valset)} tasks")
        print(f"Student model: {student_model}")
        print(f"Teacher model: {teacher_model}")
        print(f"Max iterations: {max_iterations}")

        # Create adapter
        adapter = create_arc_adapter(student_model, teacher_model)

        # Run GEPA evolution
        # Note: When adapter is provided, task_lm must be None per GEPA API
        result = optimize(
            seed_candidate={"program": seed_program},
            trainset=trainset,
            valset=valset,
            adapter=adapter,
            task_lm=None,  # Adapter handles task execution
            reflection_lm=None,  # Adapter handles reflection
            candidate_selection_strategy="pareto" if PARETO_SELECTION else "current_best",
            max_metric_calls=max_iterations,
        )

        return {
            "success": True,
            "best_program": result.best_candidate.get("program", seed_program),
            "best_score": getattr(result, "best_score", None),
            "initial_score": getattr(result, "initial_score", None),
            "improvement": (
                getattr(result, "best_score", 0) - getattr(result, "initial_score", 0)
            ),
            "iterations": getattr(result, "num_iterations", max_iterations),
            "pareto_front_size": len(getattr(result, "pareto_front", [])),
            "history": getattr(result, "history", []),
        }

    except Exception as e:
        import traceback
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }


def evaluate_program(
    program_code: str,
    tasks: list[ARCTask],
    model: str = STUDENT_MODEL,
) -> dict:
    """Evaluate a DSPy program on ARC tasks."""
    if not DSPY_AVAILABLE:
        return {"success": False, "error": "DSPy required"}

    try:
        # Build program from code
        # Use same dict for globals and locals so class definitions are available
        ns = {"dspy": dspy, "__builtins__": __builtins__}
        exec(program_code, ns, ns)
        program = ns.get("program")

        if program is None:
            return {"success": False, "error": "No 'program' found in code"}

        # Configure model
        model_config = configure_model(model)
        dspy.configure(lm=dspy.LM(**model_config))

        results = []
        total_score = 0.0

        for task in tasks:
            try:
                example = task.to_dspy_example()
                prediction = program(
                    train_examples=example.train_examples,
                    test_input=example.test_input,
                )

                # Debug: show raw output
                raw_output = getattr(prediction, 'output_grid', None)
                parsed = parse_grid_output(raw_output)
                print(f"  Task {task.task_id}:", file=sys.stderr)
                print(f"    Raw output type: {type(raw_output).__name__}", file=sys.stderr)
                print(f"    Raw output (first 200): {str(raw_output)[:200]}", file=sys.stderr)
                print(f"    Parsed: {parsed is not None}", file=sys.stderr)
                if parsed:
                    print(f"    Parsed dims: {len(parsed)}x{len(parsed[0]) if parsed else 0}", file=sys.stderr)
                print(f"    Expected dims: {len(example.test_output)}x{len(example.test_output[0])}", file=sys.stderr)

                score = arc_metric(example, prediction)

                results.append({
                    "task_id": task.task_id,
                    "score": score,
                    "exact_match": score == 1.0,
                })
                total_score += score

            except Exception as e:
                import traceback
                print(f"  Task {task.task_id} ERROR: {e}", file=sys.stderr)
                print(traceback.format_exc(), file=sys.stderr)
                results.append({
                    "task_id": task.task_id,
                    "score": 0.0,
                    "error": str(e),
                })

        return {
            "success": True,
            "total_tasks": len(tasks),
            "exact_matches": sum(1 for r in results if r.get("exact_match")),
            "pass_at_1": sum(1 for r in results if r.get("exact_match")) / len(tasks),
            "avg_score": total_score / len(tasks) if tasks else 0,
            "results": results,
        }

    except Exception as e:
        import traceback
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc(),
        }


# ============================================================================
# CLI
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="ARC-AGI DSPy Program Evolution via GEPA",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Evolve ARC solver with 10 training tasks
    python arc-agi-evolve.py --mode evolve --tasks 10 --iterations 100

    # Evaluate a program on 20 tasks
    python arc-agi-evolve.py --mode evaluate --program program.py --tasks 20

    # Quick benchmark of seed programs
    python arc-agi-evolve.py --mode benchmark --tasks 5

    # Check dependencies
    python arc-agi-evolve.py --mode status
        """
    )

    parser.add_argument(
        "--mode",
        choices=["evolve", "evaluate", "benchmark", "status"],
        default="status",
        help="Operation mode"
    )
    parser.add_argument(
        "--tasks",
        type=int,
        default=10,
        help="Number of ARC tasks to use"
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=DEFAULT_MAX_ITERATIONS,
        help="Maximum evolution iterations"
    )
    parser.add_argument(
        "--seed",
        choices=["minimal", "pattern", "advanced"],
        default="minimal",
        help="Seed program type"
    )
    parser.add_argument(
        "--program",
        type=str,
        help="Path to DSPy program file for evaluation"
    )
    parser.add_argument(
        "--student-model",
        type=str,
        default=STUDENT_MODEL,
        help="Student model for task execution"
    )
    parser.add_argument(
        "--teacher-model",
        type=str,
        default=TEACHER_MODEL,
        help="Teacher model for reflection"
    )
    parser.add_argument(
        "--output",
        type=str,
        help="Output file for evolved program"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON"
    )

    args = parser.parse_args()

    # Status check
    if args.mode == "status":
        status = {
            "dspy_available": DSPY_AVAILABLE,
            "gepa_available": GEPA_AVAILABLE,
            "student_model": STUDENT_MODEL,
            "teacher_model": TEACHER_MODEL,
            "python_version": sys.version,
        }

        if DSPY_AVAILABLE:
            status["dspy_version"] = dspy.__version__

        print(json.dumps(status, indent=2))
        return

    # Fetch ARC tasks
    print(f"Fetching {args.tasks} ARC tasks...", file=sys.stderr)
    task_ids = fetch_task_list()[:args.tasks]
    tasks = []

    for tid in task_ids:
        task = fetch_arc_task(tid)
        if task:
            tasks.append(task)
            print(f"  Loaded: {tid} ({len(task.train)} train, {len(task.test)} test)",
                  file=sys.stderr)

    print(f"Loaded {len(tasks)} tasks", file=sys.stderr)

    # Select seed program
    seed_programs = {
        "minimal": SEED_PROGRAM_MINIMAL,
        "pattern": SEED_PROGRAM_PATTERN,
        "advanced": SEED_PROGRAM_ADVANCED,
    }
    seed = seed_programs.get(args.seed, SEED_PROGRAM_MINIMAL)

    if args.mode == "evolve":
        print(f"\nStarting GEPA evolution...", file=sys.stderr)
        print(f"Seed: {args.seed}", file=sys.stderr)
        print(f"Student: {args.student_model}", file=sys.stderr)
        print(f"Teacher: {args.teacher_model}", file=sys.stderr)

        result = evolve_arc_solver(
            tasks=tasks,
            seed_program=seed,
            student_model=args.student_model,
            teacher_model=args.teacher_model,
            max_iterations=args.iterations,
        )

        if result.get("success") and args.output:
            with open(args.output, "w") as f:
                f.write(result["best_program"])
            print(f"Evolved program saved to: {args.output}", file=sys.stderr)

        if args.json:
            # Remove program code from JSON for brevity
            result_json = {k: v for k, v in result.items() if k != "best_program"}
            result_json["program_length"] = len(result.get("best_program", ""))
            print(json.dumps(result_json, indent=2))
        else:
            print("\n" + "="*60)
            print("EVOLUTION RESULTS")
            print("="*60)
            if result.get("success"):
                print(f"Best Score: {result.get('best_score', 'N/A')}")
                print(f"Initial Score: {result.get('initial_score', 'N/A')}")
                print(f"Improvement: {result.get('improvement', 'N/A')}")
                print(f"Iterations: {result.get('iterations', 'N/A')}")
                print(f"\nBest Program:\n{result.get('best_program', 'N/A')}")
            else:
                print(f"Error: {result.get('error', 'Unknown')}")

    elif args.mode == "evaluate":
        if args.program:
            with open(args.program, "r") as f:
                program_code = f.read()
        else:
            program_code = seed

        print(f"\nEvaluating program on {len(tasks)} tasks...", file=sys.stderr)
        result = evaluate_program(program_code, tasks, args.student_model)

        if args.json:
            print(json.dumps(result, indent=2))
        else:
            print("\n" + "="*60)
            print("EVALUATION RESULTS")
            print("="*60)
            if result.get("success"):
                print(f"Total Tasks: {result['total_tasks']}")
                print(f"Exact Matches: {result['exact_matches']}")
                print(f"Pass@1: {result['pass_at_1']:.2%}")
                print(f"Average Score: {result['avg_score']:.4f}")
            else:
                print(f"Error: {result.get('error', 'Unknown')}")

    elif args.mode == "benchmark":
        print(f"\nBenchmarking seed programs...", file=sys.stderr)

        results = {}
        for name, code in seed_programs.items():
            print(f"\n  Testing: {name}...", file=sys.stderr)
            result = evaluate_program(code, tasks[:min(5, len(tasks))], args.student_model)
            results[name] = {
                "pass_at_1": result.get("pass_at_1", 0),
                "avg_score": result.get("avg_score", 0),
                "exact_matches": result.get("exact_matches", 0),
            }

        if args.json:
            print(json.dumps(results, indent=2))
        else:
            print("\n" + "="*60)
            print("BENCHMARK RESULTS")
            print("="*60)
            for name, metrics in results.items():
                print(f"\n{name}:")
                print(f"  Pass@1: {metrics['pass_at_1']:.2%}")
                print(f"  Avg Score: {metrics['avg_score']:.4f}")
                print(f"  Exact Matches: {metrics['exact_matches']}")


if __name__ == "__main__":
    main()
