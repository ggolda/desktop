import React, { useEffect, useState } from 'react';
import { $t } from 'services/i18n';
import styles from './BaseElement.m.less';
import Scrollable from 'components-react/shared/Scrollable';

export default function useBaseElement(
  element: React.ReactNode,
  mins: IVec2,
  ref: HTMLDivElement | null,
) {
  const [belowMins, setBelowMins] = useState(false);
  const [height, setHeight] = useState(0);
  const [width, setWidth] = useState(0);

  // Size watching via ResizeObserver instead of a 500 ms polling interval per editor element
  // (~13 wake-ups/s with all panels — docs/rework guidelines). Note: callers pass
  // `containerRef.current`, which is still null on the first render, so (as before) this only
  // observes when an element is passed at mount time — see hypotheses I4.
  useEffect(() => {
    if (!ref || !ref.getBoundingClientRect) return;
    const update = () => {
      const rect = ref.getBoundingClientRect();
      setHeight(rect.height);
      setWidth(rect.width);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(ref);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!ref) return;
    // 26px added to account for size of the resize bars and padding
    setBelowMins(height + 26 < mins.y || width + 26 < mins.x);
  }, [width, height]);

  function renderElement() {
    return belowMins ? <BelowMinWarning /> : element;
  }

  return { renderElement };
}

function BelowMinWarning() {
  return (
    <Scrollable className={styles.container}>
      <span className={styles.empty}>{$t('This element is too small to be displayed')}</span>
    </Scrollable>
  );
}
