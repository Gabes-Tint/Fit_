"""Tests for unknown liveness checks.

The turn_in_flight function reports three outcomes: True (in flight), False
(none), or None (unknown). Unknown liveness stops --resume with exit 30
(RUN_STATE_CONFLICT) instead of continuing.
"""

import subprocess
from unittest import mock

from fitflow import agents


def test_turn_in_flight_returns_true_when_pgrep_finds_process():
    """pgrep exit 0 with pid on stdout means in flight."""
    with mock.patch("subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(
            args=["pgrep"],
            returncode=0,
            stdout="12345\n",
            stderr="",
        )

        result = agents.turn_in_flight("test-team", "mechanic")

        assert result is True


def test_turn_in_flight_returns_false_when_pgrep_matches_nothing():
    """pgrep exit 1 with empty stdout means none (False)."""
    with mock.patch("subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(
            args=["pgrep"],
            returncode=1,
            stdout="",
            stderr="",
        )

        result = agents.turn_in_flight("test-team", "mechanic")

        assert result is False


def test_turn_in_flight_returns_none_when_pgrep_exits_with_error():
    """pgrep exit 2 with stderr means unknown (None)."""
    with mock.patch("subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(
            args=["pgrep"],
            returncode=2,
            stdout="",
            stderr="pgrep: invalid option",
        )

        result = agents.turn_in_flight("test-team", "mechanic")

        assert result is None


def test_turn_in_flight_returns_none_when_pgrep_not_found():
    """subprocess.run raising FileNotFoundError means unknown (None)."""
    with mock.patch("subprocess.run") as mock_run:
        mock_run.side_effect = FileNotFoundError("pgrep not found")

        result = agents.turn_in_flight("test-team", "mechanic")

        assert result is None


def test_turn_in_flight_returns_none_when_pgrep_os_error():
    """subprocess.run raising OSError means unknown (None)."""
    with mock.patch("subprocess.run") as mock_run:
        mock_run.side_effect = OSError("permission denied")

        result = agents.turn_in_flight("test-team", "mechanic")

        assert result is None
