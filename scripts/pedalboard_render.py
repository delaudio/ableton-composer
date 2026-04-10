#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import sys


def load_pedalboard():
    try:
        from pedalboard.io import AudioFile  # type: ignore
        from pedalboard import Pedalboard  # type: ignore
        return AudioFile, Pedalboard
    except Exception:
        return None, None


def main():
    parser = argparse.ArgumentParser(description="Optional Pedalboard render worker for ableton-composer")
    parser.add_argument("--plan", required=True, help="Path to render-chain JSON")
    parser.add_argument("--mode", choices=["stems"], default="stems")
    parser.add_argument("--out", help="Optional output directory override")
    args = parser.parse_args()

    with open(args.plan, "r", encoding="utf-8") as handle:
        plan = json.load(handle)

    audio_file_cls, pedalboard_cls = load_pedalboard()
    if audio_file_cls is None or pedalboard_cls is None:
        print(
            "Pedalboard dependency not found. Install it with 'pip install pedalboard' in a Python environment and retry.",
            file=sys.stderr,
        )
        return 2

    tracks = plan.get("tracks", [])
    audio_tracks = [track for track in tracks if track.get("source", {}).get("type") == "external-stem" and track.get("source", {}).get("stem_path")]
    if not audio_tracks:
        print(
            "Pedalboard proof-of-concept currently supports external audio stems only. MIDI/instrument rendering is not implemented here.",
            file=sys.stderr,
        )
        return 3

    rendered = 0
    output_root = os.path.abspath(args.out) if args.out else None

    for track in audio_tracks:
        source_path = track["source"]["stem_path"]
        target_path = track.get("outputs", {}).get("stem_path")
        if output_root:
            target_path = os.path.join(output_root, os.path.basename(target_path or source_path))

        if not target_path:
            continue

        if not os.path.exists(source_path):
            print(f"Missing source stem: {source_path}", file=sys.stderr)
            return 4

        os.makedirs(os.path.dirname(target_path), exist_ok=True)
        shutil.copyfile(source_path, target_path)
        rendered += 1

    print(json.dumps({
        "rendered_tracks": rendered,
        "mode": args.mode,
        "plan": args.plan,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
