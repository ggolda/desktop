// Local typed shim of the obs-studio-node surface this adapter uses. The package types are not
// resolvable in every checkout (placeholder tarballs) and `NodeObs.OBS_content_*` is untyped there.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface CropInfo {
  left: number;
  top: number;
  right: number;
  bottom: number;
  referenceWidth?: number;
  referenceHeight?: number;
}

export interface VideoInfo {
  fpsNum: number;
  fpsDen: number;
  baseWidth: number;
  baseHeight: number;
  outputWidth: number;
  outputHeight: number;
  outputFormat: number;
  colorspace: number;
  range: number;
  scaleType: number;
  fpsType: number;
}

export interface OsnVideo {
  video: VideoInfo;
  legacySettings: VideoInfo;
  destroy(): void;
}

export interface OsnProperty {
  readonly name: string;
  readonly description: string;
  readonly longDescription: string;
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly type: number;
  readonly value: any;
  readonly details?: any;
  next(): OsnProperty | null;
  buttonClicked?(source: object): void;
}

export interface OsnProperties {
  first(): OsnProperty | null;
  count(): number;
  get(name: string): OsnProperty | null;
}

export interface OsnSource {
  readonly id: string;
  name: string;
  muted: boolean;
  flags: number;
  readonly outputFlags: number;
  readonly settings: Record<string, any>;
  readonly configurable: boolean;
  readonly properties: OsnProperties | null;
  update(settings: Record<string, any>): void;
  save(): void;
  release(): void;
  remove(): void;
}

export interface OsnFilter extends OsnSource {
  enabled: boolean;
}

export interface OsnInput extends OsnSource {
  volume: number;
  syncOffset: { sec: number; nsec: number };
  audioMixers: number;
  monitoringType: number;
  readonly filters: OsnFilter[];
  readonly width: number;
  readonly height: number;
}

export interface OsnSceneItem {
  readonly id: number;
  selected: boolean;
  position: Vec2;
  scale: Vec2;
  rotation: number;
  crop: CropInfo;
  visible: boolean;
  streamVisible: boolean;
  recordingVisible: boolean;
  scaleFilter: number;
  blendingMode: number;
  blendingMethod: number;
  video: OsnVideo | null;
  readonly transformInfo: { pos: Vec2; rot: number; scale: Vec2 };
  deferUpdateBegin(): void;
  deferUpdateEnd(): void;
  remove(): void;
}

export interface OsnSceneItemInfo {
  name: string;
  crop: CropInfo;
  scaleX: number;
  scaleY: number;
  visible: boolean;
  x: number;
  y: number;
  rotation: number;
  streamVisible: boolean;
  recordingVisible: boolean;
  scaleFilter: number;
  blendingMode: number;
  blendingMethod: number;
}

export interface OsnScene extends OsnSource {
  readonly source: OsnInput;
  add(source: OsnInput, info?: OsnSceneItemInfo, video?: OsnVideo): OsnSceneItem;
  moveItem(oldIndex: number, newIndex: number): void;
  getItems(): OsnSceneItem[];
}

export interface OsnTransition extends OsnSource {
  set(input: OsnSource): void;
  start(ms: number, input: OsnSource): void;
}

export interface OsnFader {
  db: number;
  deflection: number;
  mul: number;
  attach(source: OsnInput): void;
  detach(): void;
  destroy(): void;
}

export interface OsnVolmeter {
  attach(source: OsnInput): void;
  detach(): void;
  destroy(): void;
}

export interface OsnSourceCreateInfo {
  name: string;
  type: string;
  muted: boolean;
  settings: Record<string, any>;
  volume: number;
  syncOffset: { sec: number; nsec: number };
  deinterlaceMode: number;
  deinterlaceFieldOrder: number;
  filters: { name: string; type: string; settings: Record<string, any>; enabled: boolean }[];
}

export interface Osn {
  IPC: { host(id: string): unknown; disconnect(): void };
  NodeObs: {
    SetWorkingDirectory(dir: string): void;
    OBS_API_initAPI(opts: {
      language: string;
      appDataPath: string;
      version: string;
      crashServerUrl: string;
    }): number;
    InitShutdownSequence(): void;
    RegisterVolmeterCallback(
      cb: (
        objs: {
          sourceName: string;
          magnitude: number[];
          peak: number[];
          inputPeak: number[];
        }[],
      ) => void,
    ): void;
    RegisterSourceCallback(
      cb: (objs: { name: string; width: number; height: number; flags: number }[]) => void,
    ): void;
    [k: string]: any;
  };
  Video: { video: VideoInfo; legacySettings: VideoInfo };
  VideoFactory: { create(): OsnVideo };
  InputFactory: { fromName(name: string): OsnInput; types(): string[] };
  SceneFactory: { create(name: string): OsnScene };
  TransitionFactory: {
    create(type: string, name: string, settings?: Record<string, any>): OsnTransition;
  };
  FaderFactory: { create(type: number): OsnFader };
  VolmeterFactory: { create(type: number): OsnVolmeter };
  Global: {
    setOutputSource(channel: number, source: OsnSource | null): void;
  };
  createSources(infos: OsnSourceCreateInfo[]): OsnInput[];
  addItems(scene: OsnScene, infos: OsnSceneItemInfo[]): OsnSceneItem[];
  getSourcesSize(names: string[]): { name: string; width: number; height: number; outputFlags: number }[];
}
