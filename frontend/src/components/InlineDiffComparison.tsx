import { useMemo } from 'react';
import { diffChars } from 'diff';

interface InlineDiffComparisonProps {
  original: string;
  revised: string;
}

type DiffSide = 'original' | 'revised';

export default function InlineDiffComparison({ original, revised }: InlineDiffComparisonProps) {
  const changes = useMemo(() => diffChars(original, revised), [original, revised]);

  const renderSide = (side: DiffSide) => changes.map((change, index) => {
    if (side === 'original' && change.added) return null;
    if (side === 'revised' && change.removed) return null;

    const tone = change.removed ? 'removed' : change.added ? 'added' : 'equal';
    return (
      <span key={`${side}-${index}`} className={`polish-inline-token polish-inline-token--${tone}`}>
        {change.value}
      </span>
    );
  });

  return (
    <div className="polish-inline-diff" aria-label="原文与改写后逐字对照">
      <div className="polish-inline-columns">
        <article className="polish-inline-pane polish-inline-pane--original" aria-label="原文">
          <header className="polish-inline-head">
            <span className="polish-inline-dot polish-inline-dot--removed" />
            <strong>原文</strong>
            <small>{original.length} 字</small>
          </header>
          <div className="polish-inline-copy">{renderSide('original')}</div>
        </article>
        <article className="polish-inline-pane polish-inline-pane--revised" aria-label="改写后">
          <header className="polish-inline-head">
            <span className="polish-inline-dot polish-inline-dot--added" />
            <strong>改写后</strong>
            <small>{revised.length} 字</small>
          </header>
          <div className="polish-inline-copy">{renderSide('revised')}</div>
        </article>
      </div>
      <footer className="polish-inline-legend">
        <span>
          <i className="polish-inline-legend-swatch polish-inline-legend-swatch--removed" />
          红色为被改掉的写法
        </span>
        <span>
          <i className="polish-inline-legend-swatch polish-inline-legend-swatch--added" />
          绿色为改写后新增的内容
        </span>
      </footer>
    </div>
  );
}
