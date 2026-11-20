<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide, toRef } from 'vue';
import type { Property, PropertyValue } from '@/shared/contracts';
import { commands } from '@/ui/core';
import { commitDelay, usePropertyEdits, type FormLayout } from './edits';
import BoolField from './fields/BoolField.vue';
import ButtonField from './fields/ButtonField.vue';
import ColorField from './fields/ColorField.vue';
import EditableListField from './fields/EditableListField.vue';
import FontField from './fields/FontField.vue';
import InfoField from './fields/InfoField.vue';
import ListField from './fields/ListField.vue';
import PathField from './fields/PathField.vue';
import SliderField from './fields/SliderField.vue';
import TextField from './fields/TextField.vue';
import FormRow from './FormRow.vue';

/**
 * Renders a `Property[]` (slice `properties:<dialogId>`) with one control per kind, in the legacy look.
 * Edits are optimistic and debounced per kind (legacy table, `edits.ts`) and sent as ONE changed
 * property like legacy. `visible: false` rows are not rendered, `enabled: false` rows are disabled,
 * `unsupported` kinds render nothing.
 */
const props = defineProps<{
  sourceId: string;
  items: readonly Property[];
  layout: FormLayout;
}>();

provide('propLayout', props.layout);
const edits = usePropertyEdits(() => props.sourceId);
const layout = toRef(props, 'layout');

const shown = (p: Property): unknown =>
  edits.has(p.name) ? edits.local[p.name] : 'value' in p ? p.value : undefined;

const delayOf = (p: Property) => commitDelay(p, layout.value);

function onInput(p: Property, v: PropertyValue) {
  const d = delayOf(p);
  if (d < 0) edits.hold(p.name, v);
  else edits.edit(p.name, v, d);
}
function onChange(p: Property, v: PropertyValue) {
  // a debounced edit is flushed now; edits that already went out are not sent twice
  if (delayOf(p) < 0 || edits.hasPending(p.name)) edits.edit(p.name, v, 0);
}
function onInvalid(p: Property, raw: string) {
  edits.hold(p.name, raw as unknown as PropertyValue);
}
const onEdit = (p: Property, v: PropertyValue) => edits.edit(p.name, v, 0);

async function press(p: Property) {
  edits.flush();
  try {
    await commands.properties.press(props.sourceId, p.name);
  } catch (e) {
    console.error('[properties] press failed:', e instanceof Error ? e.message : e);
  }
}

// the window may go away with an edit still waiting for its debounce
onMounted(() => window.addEventListener('pagehide', edits.flush));
onBeforeUnmount(() => window.removeEventListener('pagehide', edits.flush));
defineExpose({ flush: edits.flush });
</script>

<template>
  <div data-testid="property-form" :data-layout="layout">
    <template v-for="p in items" :key="p.name">
      <template v-if="p.visible && p.kind !== 'unsupported'">
        <FormRow v-if="p.kind === 'bool'" check>
          <BoolField :p="p" :value="shown(p)" :disabled="!p.enabled" @edit="v => onEdit(p, v)" />
        </FormRow>
        <FontField
          v-else-if="p.kind === 'font'"
          :p="p"
          :value="shown(p)"
          :disabled="!p.enabled"
          @edit="v => onEdit(p, v)"
          @input="v => edits.edit(p.name, v, layout === 'horizontal' ? 500 : 100)"
        />
        <FormRow v-else-if="p.kind === 'button'" check :tip="p.longDescription">
          <ButtonField :p="p" :disabled="!p.enabled" @press="press(p)" />
        </FormRow>
        <FormRow v-else-if="p.kind === 'info'">
          <InfoField :p="p" :value="shown(p)" />
        </FormRow>
        <FormRow
          v-else
          :label="p.description"
          :tip="p.longDescription"
          :gap="
            layout === 'vertical' && (p.kind.startsWith('path') || p.kind === 'color')
              ? 8
              : undefined
          "
        >
          <SliderField
            v-if="p.kind === 'slider'"
            :p="p"
            :value="shown(p)"
            :disabled="!p.enabled"
            @input="v => onInput(p, v)"
            @invalid="raw => onInvalid(p, raw)"
          />
          <TextField
            v-else-if="
              p.kind === 'text' ||
              p.kind === 'password' ||
              p.kind === 'multiline' ||
              p.kind === 'int' ||
              p.kind === 'float'
            "
            :p="p"
            :value="shown(p)"
            :disabled="!p.enabled"
            @input="v => onInput(p, v)"
            @change="v => onChange(p, v)"
            @invalid="raw => onInvalid(p, raw)"
          />
          <ListField
            v-else-if="p.kind === 'list'"
            :p="p"
            :value="shown(p)"
            :disabled="!p.enabled"
            @edit="v => onEdit(p, v)"
            @invalid="raw => onInvalid(p, raw)"
          />
          <ColorField
            v-else-if="p.kind === 'color'"
            :p="p"
            :value="shown(p)"
            :disabled="!p.enabled"
            @input="v => onInput(p, v)"
            @change="v => onChange(p, v)"
          />
          <PathField
            v-else-if="p.kind === 'path-file' || p.kind === 'path-save' || p.kind === 'path-dir'"
            :p="p"
            :value="shown(p)"
            :disabled="!p.enabled"
            @input="v => onInput(p, v)"
            @change="v => onChange(p, v)"
          />
          <EditableListField
            v-else-if="p.kind === 'editable-list'"
            :p="p"
            :value="shown(p)"
            :disabled="!p.enabled"
            @edit="v => onEdit(p, v)"
          />
        </FormRow>
      </template>
    </template>
  </div>
</template>
