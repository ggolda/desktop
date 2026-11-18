import { OverlayScrollbarsComponent } from 'overlayscrollbars-vue';
import TsxComponent, { createProps } from 'components/tsx-component';
import { Component } from 'vue-property-decorator';

class ScrollableProps {
  className?: string = '';
  isResizable?: boolean = true;
  horizontal?: boolean = false;
  /**
   * Has performance implications. Should only be used where
   * absolutely necessary.
   */
  autoSizeCapable?: boolean = false;
}

@Component({ props: createProps(ScrollableProps) })
export default class Scrollable extends TsxComponent<ScrollableProps> {
  render() {
    return (
      <OverlayScrollbarsComponent
        options={{
          // null = event-driven (MutationObserver). `true` makes OverlayScrollbars poll in a
          // requestAnimationFrame loop, which forces a frame on every vsync (docs/rework, H16).
          autoUpdate: null,
          className: this.props.className,
          resize: this.props.isResizable ? 'both' : 'none',
          sizeAutoCapable: this.props.autoSizeCapable,
          scrollbars: { clickScrolling: true },
          overflowBehavior: { x: this.props.horizontal ? 'scroll' : 'hidden' },
        }}
      >
        {this.$slots.default}
      </OverlayScrollbarsComponent>
    );
  }
}
