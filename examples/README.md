# Example Corpus

Small synthetic fixtures for import/export, analysis, visualization, and thesis evaluation workflows.

All material here is original and intentionally minimal. These files are meant for smoke tests and demos, not as polished musical examples.

## Fixtures

- `ableton-song/monophonic-melody.song.json`: one lead line over one section.
- `ableton-song/chord-progression.song.json`: chord clip plus section harmony metadata.
- `ableton-song/drum-pattern.song.json`: simple General MIDI drum pattern.
- `ableton-song/multi-section-song.song.json`: intro/main/breakdown arrangement with roles.
- `musicxml/simple-harmony-lyrics.musicxml`: MusicXML score with melody, harmony symbols, and lyrics.
- `midi/simple-melody.mid`: small MIDI file for `import-midi` smoke tests.

## Smoke Commands

```bash
ableton-composer analyze examples/ableton-song/monophonic-melody.song.json --scope song --print
ableton-composer import-xml examples/musicxml/simple-harmony-lyrics.musicxml --chord-track --out /tmp/ac-simple-xml/
ableton-composer import-midi examples/midi/simple-melody.mid --out /tmp/ac-simple-midi/
```

The `/tmp` outputs are disposable. They should include `_format` and `meta.provenance` when saved through current commands.
