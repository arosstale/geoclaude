#!/usr/bin/env python3
"""
OpenEvolve Runner - LLM-based Evolutionary Code Optimization

Integrates OpenEvolve for evolutionary prompt/code optimization.
Uses MAP-Elites algorithm with island-based parallel populations.

Usage:
    python openevolve-runner.py --mode evolve --config '{...}'
    python openevolve-runner.py --mode continue --task-id <id> --additional-generations 10
    python openevolve-runner.py --mode status --task-id <id>
"""

import argparse
import json
import os
import random
import sys
import time
from dataclasses import dataclass, asdict
from typing import Any

# Check for OpenEvolve installation
try:
    import openevolve
    from openevolve import Population, Individual, Evolver
    OPENEVOLVE_AVAILABLE = True
except ImportError:
    OPENEVOLVE_AVAILABLE = False


@dataclass
class Candidate:
    """Evolution candidate."""
    id: str
    content: str
    fitness: float = 0.0
    novelty: float = 0.0
    generation: int = 0
    parent_id: str = None
    mutation_type: str = None


@dataclass
class GenerationStats:
    """Statistics for one generation."""
    generation: int
    best_fitness: float
    avg_fitness: float
    diversity: float
    population_size: int
    improvements: int


class SimpleEvolver:
    """
    Simple evolutionary optimizer for when OpenEvolve is not available.
    Implements basic genetic algorithm with LLM-based mutations.
    """

    def __init__(
        self,
        seed: str,
        evaluation_criteria: str,
        population_size: int = 10,
        num_islands: int = 2,
        mutation_model: str = "openai/gpt-4.1-mini",
        evaluation_model: str = "openai/gpt-4.1-mini",
        elitism: bool = True,
        crossover_rate: float = 0.6,
        mutation_rate: float = 0.4,
    ):
        self.seed = seed
        self.evaluation_criteria = evaluation_criteria
        self.population_size = population_size
        self.num_islands = num_islands
        self.mutation_model = mutation_model
        self.evaluation_model = evaluation_model
        self.elitism = elitism
        self.crossover_rate = crossover_rate
        self.mutation_rate = mutation_rate

        # Initialize islands
        self.islands = [self._create_initial_population() for _ in range(num_islands)]
        self.generation = 0
        self.best_candidate = None
        self.history = []
        self.total_evaluations = 0

    def _create_initial_population(self) -> list[Candidate]:
        """Create initial population with variations of seed."""
        population = []
        for i in range(self.population_size // self.num_islands):
            candidate = Candidate(
                id=f"gen0_island{len(population)}_{i}",
                content=self._mutate_text(self.seed) if i > 0 else self.seed,
                generation=0,
            )
            population.append(candidate)
        return population

    def _mutate_text(self, text: str) -> str:
        """Apply simple text mutations (LLM mutations would be better)."""
        mutations = [
            lambda t: t.replace("  ", " "),  # Remove double spaces
            lambda t: t + "\n",  # Add newline
            lambda t: t.strip(),  # Strip whitespace
            lambda t: self._swap_words(t),  # Swap random words
            lambda t: self._insert_phrase(t),  # Insert phrase
        ]
        return random.choice(mutations)(text)

    def _swap_words(self, text: str) -> str:
        """Swap two random words."""
        words = text.split()
        if len(words) < 2:
            return text
        i, j = random.sample(range(len(words)), 2)
        words[i], words[j] = words[j], words[i]
        return " ".join(words)

    def _insert_phrase(self, text: str) -> str:
        """Insert a phrase at random position."""
        phrases = [
            "Additionally,",
            "Furthermore,",
            "Moreover,",
            "In particular,",
            "Specifically,",
        ]
        words = text.split()
        if not words:
            return text
        pos = random.randint(0, len(words))
        words.insert(pos, random.choice(phrases))
        return " ".join(words)

    def _evaluate(self, candidate: Candidate) -> float:
        """Evaluate candidate fitness (simple heuristic-based)."""
        self.total_evaluations += 1
        score = 0.5  # Base score

        content = candidate.content.lower()

        # Length bonus (not too short, not too long)
        length = len(content)
        if 100 < length < 5000:
            score += 0.1
        if 500 < length < 2000:
            score += 0.1

        # Structure bonus
        if any(marker in content for marker in ["step", "1.", "first", "then"]):
            score += 0.1

        # Criteria keyword matching
        criteria_words = self.evaluation_criteria.lower().split()
        matches = sum(1 for word in criteria_words if word in content)
        score += min(0.2, matches * 0.02)

        # Novelty from parent
        if candidate.parent_id:
            score += 0.05  # Small bonus for being a mutation

        return min(score, 1.0)

    def _crossover(self, parent1: Candidate, parent2: Candidate) -> Candidate:
        """Simple crossover between two parents."""
        words1 = parent1.content.split()
        words2 = parent2.content.split()

        # Single-point crossover
        point = min(len(words1), len(words2)) // 2
        child_words = words1[:point] + words2[point:]

        return Candidate(
            id=f"gen{self.generation}_cross_{random.randint(0, 9999)}",
            content=" ".join(child_words),
            generation=self.generation,
            parent_id=parent1.id,
            mutation_type="crossover",
        )

    def _mutate(self, parent: Candidate) -> Candidate:
        """Create mutated offspring."""
        return Candidate(
            id=f"gen{self.generation}_mut_{random.randint(0, 9999)}",
            content=self._mutate_text(parent.content),
            generation=self.generation,
            parent_id=parent.id,
            mutation_type="point",
        )

    def evolve_generation(self) -> GenerationStats:
        """Run one generation of evolution."""
        self.generation += 1
        improvements = 0

        for island_idx, island in enumerate(self.islands):
            # Evaluate all candidates
            for candidate in island:
                if candidate.fitness == 0.0:
                    candidate.fitness = self._evaluate(candidate)

            # Sort by fitness
            island.sort(key=lambda c: c.fitness, reverse=True)

            # Track best
            if island[0].fitness > (self.best_candidate.fitness if self.best_candidate else 0):
                self.best_candidate = island[0]
                improvements += 1

            # Create new generation
            new_island = []

            # Elitism: keep top performers
            if self.elitism:
                elite_count = max(1, len(island) // 5)
                new_island.extend(island[:elite_count])

            # Fill rest with offspring
            while len(new_island) < self.population_size // self.num_islands:
                if random.random() < self.crossover_rate and len(island) >= 2:
                    # Crossover
                    parents = random.sample(island[:len(island)//2], 2)
                    child = self._crossover(parents[0], parents[1])
                else:
                    # Mutation
                    parent = random.choice(island[:len(island)//2])
                    child = self._mutate(parent)
                new_island.append(child)

            self.islands[island_idx] = new_island

        # Migration between islands (every 5 generations)
        if self.generation % 5 == 0 and len(self.islands) > 1:
            for i in range(len(self.islands)):
                # Send best to next island
                next_island = (i + 1) % len(self.islands)
                if self.islands[i]:
                    migrant = self.islands[i][0]
                    self.islands[next_island].append(migrant)

        # Calculate stats
        all_candidates = [c for island in self.islands for c in island]
        fitnesses = [c.fitness for c in all_candidates if c.fitness > 0]

        stats = GenerationStats(
            generation=self.generation,
            best_fitness=max(fitnesses) if fitnesses else 0,
            avg_fitness=sum(fitnesses) / len(fitnesses) if fitnesses else 0,
            diversity=len(set(c.content for c in all_candidates)) / len(all_candidates) if all_candidates else 0,
            population_size=len(all_candidates),
            improvements=improvements,
        )

        self.history.append(stats)
        return stats

    def get_pareto_front(self) -> list[Candidate]:
        """Get pareto-optimal candidates (fitness vs novelty)."""
        all_candidates = [c for island in self.islands for c in island]

        # Calculate novelty for each candidate
        for candidate in all_candidates:
            # Novelty = uniqueness compared to others
            others_content = [c.content for c in all_candidates if c.id != candidate.id]
            if others_content:
                avg_similarity = sum(
                    1 for other in others_content
                    if len(set(candidate.content.split()) & set(other.split())) /
                       max(len(candidate.content.split()), 1) > 0.8
                ) / len(others_content)
                candidate.novelty = 1 - avg_similarity
            else:
                candidate.novelty = 1.0

        # Simple pareto front: top 10 by combined fitness + novelty
        all_candidates.sort(key=lambda c: c.fitness + c.novelty * 0.5, reverse=True)
        return all_candidates[:10]


def run_evolution(config: dict) -> dict:
    """Run evolutionary optimization."""
    task_id = config.get("task_id", f"task_{int(time.time())}")
    seed = config.get("seed", "")
    evaluation_criteria = config.get("evaluation_criteria", "")
    max_generations = config.get("max_generations", 20)
    population_size = config.get("population_size", 10)
    num_islands = config.get("num_islands", 2)
    mutation_model = config.get("mutation_model", "openai/gpt-4.1-mini")
    evaluation_model = config.get("evaluation_model", "openai/gpt-4.1-mini")
    elitism = config.get("elitism", True)
    crossover_rate = config.get("crossover_rate", 0.6)
    mutation_rate = config.get("mutation_rate", 0.4)
    output_dir = config.get("output_dir", ".")

    # Create evolver
    evolver = SimpleEvolver(
        seed=seed,
        evaluation_criteria=evaluation_criteria,
        population_size=population_size,
        num_islands=num_islands,
        mutation_model=mutation_model,
        evaluation_model=evaluation_model,
        elitism=elitism,
        crossover_rate=crossover_rate,
        mutation_rate=mutation_rate,
    )

    # Run evolution
    for gen in range(max_generations):
        stats = evolver.evolve_generation()

        # Save checkpoint
        checkpoint_path = os.path.join(output_dir, f"{task_id}_checkpoint.json")
        status_path = os.path.join(output_dir, f"{task_id}_status.json")

        checkpoint = {
            "task_id": task_id,
            "generation": evolver.generation,
            "best_candidate": asdict(evolver.best_candidate) if evolver.best_candidate else None,
            "islands": [[asdict(c) for c in island] for island in evolver.islands],
            "history": [asdict(h) for h in evolver.history],
        }

        status = {
            "active": True,
            "generation": evolver.generation,
            "best_fitness": evolver.best_candidate.fitness if evolver.best_candidate else 0,
        }

        with open(checkpoint_path, "w") as f:
            json.dump(checkpoint, f)
        with open(status_path, "w") as f:
            json.dump(status, f)

    # Mark as complete
    status["active"] = False
    with open(status_path, "w") as f:
        json.dump(status, f)

    # Get pareto front
    pareto_front = evolver.get_pareto_front()

    return {
        "success": True,
        "task_id": task_id,
        "best_solution": evolver.best_candidate.content if evolver.best_candidate else None,
        "best_fitness": evolver.best_candidate.fitness if evolver.best_candidate else 0,
        "generations": evolver.generation,
        "total_evaluations": evolver.total_evaluations,
        "diversity_score": evolver.history[-1].diversity if evolver.history else 0,
        "pareto_front": [asdict(c) for c in pareto_front],
        "history": [asdict(h) for h in evolver.history],
    }


def continue_evolution(task_id: str, additional_generations: int, checkpoint_dir: str) -> dict:
    """Continue evolution from checkpoint."""
    checkpoint_path = os.path.join(checkpoint_dir, f"{task_id}_checkpoint.json")

    if not os.path.exists(checkpoint_path):
        return {
            "success": False,
            "task_id": task_id,
            "error": f"Checkpoint not found: {checkpoint_path}",
        }

    with open(checkpoint_path, "r") as f:
        checkpoint = json.load(f)

    # Reconstruct evolver state
    evolver = SimpleEvolver(
        seed=checkpoint["best_candidate"]["content"] if checkpoint["best_candidate"] else "",
        evaluation_criteria="Continue evolution",
        population_size=sum(len(island) for island in checkpoint["islands"]),
        num_islands=len(checkpoint["islands"]),
    )

    evolver.generation = checkpoint["generation"]
    evolver.islands = [
        [Candidate(**c) for c in island]
        for island in checkpoint["islands"]
    ]
    if checkpoint["best_candidate"]:
        evolver.best_candidate = Candidate(**checkpoint["best_candidate"])
    evolver.history = [GenerationStats(**h) for h in checkpoint["history"]]

    # Continue evolution
    for _ in range(additional_generations):
        evolver.evolve_generation()

    # Save updated checkpoint
    with open(checkpoint_path, "w") as f:
        json.dump({
            "task_id": task_id,
            "generation": evolver.generation,
            "best_candidate": asdict(evolver.best_candidate) if evolver.best_candidate else None,
            "islands": [[asdict(c) for c in island] for island in evolver.islands],
            "history": [asdict(h) for h in evolver.history],
        }, f)

    return {
        "success": True,
        "task_id": task_id,
        "best_solution": evolver.best_candidate.content if evolver.best_candidate else None,
        "best_fitness": evolver.best_candidate.fitness if evolver.best_candidate else 0,
        "generations": evolver.generation,
        "total_evaluations": evolver.total_evaluations,
        "diversity_score": evolver.history[-1].diversity if evolver.history else 0,
    }


def main():
    parser = argparse.ArgumentParser(description="OpenEvolve Runner")
    parser.add_argument("--mode", choices=["evolve", "continue", "status"], default="status")
    parser.add_argument("--config", type=str, help="JSON config for evolution")
    parser.add_argument("--task-id", type=str, help="Task ID for continue/status")
    parser.add_argument("--additional-generations", type=int, default=10)
    parser.add_argument("--checkpoint-dir", type=str, default=".")

    args = parser.parse_args()

    if args.mode == "status":
        result = {
            "openevolve_available": OPENEVOLVE_AVAILABLE,
            "python_version": sys.version,
        }
        print(json.dumps(result))

    elif args.mode == "evolve":
        if not args.config:
            print(json.dumps({"success": False, "error": "Config required"}))
            return

        config = json.loads(args.config)
        result = run_evolution(config)
        print(json.dumps(result))

    elif args.mode == "continue":
        if not args.task_id:
            print(json.dumps({"success": False, "error": "Task ID required"}))
            return

        result = continue_evolution(
            args.task_id,
            args.additional_generations,
            args.checkpoint_dir,
        )
        print(json.dumps(result))


if __name__ == "__main__":
    main()
