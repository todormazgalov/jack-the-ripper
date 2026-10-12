import { SLOT_COUNT, slotLabel, type GameView } from '@jtr/shared';

const slots = Array.from({ length: SLOT_COUNT }, (_, i) => i);


/** Jack's secret move track sheet: one row per night. */
export function JackSheet({ view }: { view: GameView }) {
  return (
    <div className="sheet">
      <div className="sheet-head">Move track sheet · hideout <span className="oval">{view.hideout ?? '?'}</span></div>
      <table>
        <thead>
          <tr><th />{slots.map((i) => <th key={i} className={i < 5 ? 'roman' : ''}>{slotLabel(i)}</th>)}</tr>
        </thead>
        <tbody>
          {view.sheet!.map((row, n) => (
            <tr key={n} className={n + 1 === view.night ? 'now' : ''}>
              <th>{n + 1}</th>
              {row.map((v, i) => <td key={i} className={i < 5 ? 'roman' : ''}>{v ?? ''}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
