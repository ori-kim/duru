export { clackRenderer, clackRendererPlugin } from "@duru/renderer-clack";

export {
  text,
  multiline,
  password,
  select,
  selectKey,
  checkbox,
  autocomplete,
  autocompleteCheckbox,
  confirm,
  date,
  path,
} from "./feature.ts";
export type {
  TextFeatureOptions,
  MultilineFeatureOptions,
  PasswordFeatureOptions,
  SelectFeatureOptions,
  SelectKeyFeatureOptions,
  CheckboxFeatureOptions,
  AutocompleteFeatureOptions,
  AutocompleteCheckboxFeatureOptions,
  ConfirmFeatureOptions,
  DateFeatureOptions,
  PathFeatureOptions,
} from "./feature.ts";

export {
  createClackInput,
  useClack,
  ClackCancelError,
  CLACK_INPUT_SERVICE_KEY,
} from "./prompt.ts";
export type {
  SelectOption,
  ClackInput,
  ClackInputContext,
} from "./prompt.ts";

export type {
  StandardSchemaV1,
  StandardResult,
  StandardIssue,
  ValidatorFn,
} from "./schema.ts";
export { fromSchema, composeValidator } from "./schema.ts";

export { clackPlugin } from "./plugin.ts";
