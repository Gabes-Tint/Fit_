"""Where a release's APK is kept once its worktree is gone.

`android:release` builds into the release worktree, which the same run
then removes: an artifact reported by a path inside it names nothing a
minute later. The build is copied out under `FIT_FLOW_HOME/releases/<tag>`
and re-hashed there, so the sha256 in the record is the one the file that
survives actually has.
"""

import hashlib
import shutil
from pathlib import Path

from fitflow import settings

APK_NAME = "app-release.apk"


def release_dir(tag: str) -> Path:
    return settings.FIT_FLOW_HOME / "releases" / tag


def keep_apk(tag: str, built: Path) -> Path:
    """Copy a freshly built APK out of the worktree it was built in."""
    destination = release_dir(tag) / APK_NAME
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(built, destination)
    return destination


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()
