import { type ChangeEvent, useState } from 'react';
import type { ImportPreviewItem, ImportResult } from '../../../shared/types';
import { api } from '../api';
import { buildColors, type Choice, initialChoices } from '../lib/importColors';

export function ImportPgnDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [pgn, setPgn] = useState('');
  const [preview, setPreview] = useState<ImportPreviewItem[] | null>(null);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPgn(await file.text());
    setPreview(null);
    setChoices([]);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doPreview = () =>
    run(async () => {
      const items = await api.previewImport(pgn);
      setPreview(items);
      setChoices(initialChoices(items));
    });

  const doImport = () =>
    run(async () => {
      if (!preview) return;
      setResult(await api.importPgn(pgn, buildColors(preview, choices)));
      onImported();
    });

  const importable = preview?.some((i) => i.skippedReason === null) ?? false;

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-label="Import PGN">
        <h2>Import PGN</h2>
        {result ? (
          <>
            <p className="ok">
              Imported {result.inserted}, duplicates {result.duplicates}, skipped {result.skipped}.
            </p>
            <button type="button" onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            <textarea
              rows={8}
              placeholder="Paste PGN here"
              value={pgn}
              onChange={(e) => {
                setPgn(e.target.value);
                setPreview(null);
                setChoices([]);
              }}
            />
            <input type="file" accept=".pgn,text/plain" onChange={(e) => void onFile(e)} />
            {preview && (
              <table>
                <thead>
                  <tr><th>#</th><th>White</th><th>Black</th><th>Date</th><th>Your colour</th></tr>
                </thead>
                <tbody>
                  {preview.map((item, i) => (
                    <tr key={item.index}>
                      <td>{item.index + 1}</td>
                      <td>{item.white}</td>
                      <td>{item.black}</td>
                      <td>{item.date ?? ''}</td>
                      <td>
                        {item.skippedReason !== null ? (
                          <span className="muted">Skipped: {item.skippedReason}</span>
                        ) : item.detectedColor !== null ? (
                          item.detectedColor
                        ) : (
                          <select
                            aria-label={`Colour for game ${item.index + 1}`}
                            value={choices[i]}
                            onChange={(e) =>
                              setChoices(choices.map((c, j) => (j === i ? (e.target.value as Choice) : c)))
                            }
                          >
                            <option value="white">White</option>
                            <option value="black">Black</option>
                            <option value="none">Neither</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {error && <p className="error">{error}</p>}
            <div className="actions">
              <button type="button" disabled={busy || pgn.trim() === ''} onClick={() => void doPreview()}>
                Preview
              </button>
              <button type="button" disabled={busy || !importable} onClick={() => void doImport()}>
                Import
              </button>
              <button type="button" className="link" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
