> Source: https://github.com/modelcontextprotocol/specification/blob/main/schema/2026-07-28/schema.ts
> (raw: https://raw.githubusercontent.com/modelcontextprotocol/specification/main/schema/2026-07-28/schema.ts)
> Spec revision: 2026-07-28
> Retrieved: 2026-08-11
>
> This is the canonical TypeScript schema — the specification's own source of
> truth for all protocol messages and structures (see
> https://modelcontextprotocol.io/specification/2026-07-28/basic/index#schema).
> Captured from the schema.ts source directly rather than the typedoc-rendered
> HTML at https://modelcontextprotocol.io/specification/2026-07-28/schema.md,
> which is generated from this same file, for a cleaner verbatim capture.
>
> PART 6 of the schema capture: Autocomplete, roots and elicitation. Verbatim slice of schema.ts, source lines 2598-3167
> (as numbered inside the captured code block of the original single-file capture).

---

# Schema Reference (schema.ts, 2026-07-28) — Autocomplete, roots and elicitation

```typescript
/* Autocomplete */
/**
 * Parameters for a `completion/complete` request.
 *
 * @category `completion/complete`
 *
 * @example Prompt argument completion
 * {@includeCode ./examples/CompleteRequestParams/prompt-argument-completion.json}
 *
 * @example Prompt argument completion with context
 * {@includeCode ./examples/CompleteRequestParams/prompt-argument-completion-with-context.json}
 */
export interface CompleteRequestParams extends RequestParams {
  ref: PromptReference | ResourceTemplateReference;
  /**
   * The argument's information
   */
  argument: {
    /**
     * The name of the argument
     */
    name: string;
    /**
     * The value of the argument to use for completion matching.
     */
    value: string;
  };

  /**
   * Additional, optional context for completions
   */
  context?: {
    /**
     * Previously-resolved variables in a URI template or prompt.
     */
    arguments?: { [key: string]: string };
  };
}

/**
 * A request from the client to the server, to ask for completion options.
 *
 * @example Completion request
 * {@includeCode ./examples/CompleteRequest/completion-request.json}
 *
 * @category `completion/complete`
 */
export interface CompleteRequest extends JSONRPCRequest {
  method: "completion/complete";
  params: CompleteRequestParams;
}

/**
 * The result returned by the server for a {@link CompleteRequest | completion/complete} request.
 *
 * @category `completion/complete`
 *
 * @example Single completion value
 * {@includeCode ./examples/CompleteResult/single-completion-value.json}
 *
 * @example Multiple completion values with more available
 * {@includeCode ./examples/CompleteResult/multiple-completion-values-with-more-available.json}
 */
export interface CompleteResult extends Result {
  completion: {
    /**
     * An array of completion values. Must not exceed 100 items.
     *
     * @maxItems 100
     */
    values: string[];
    /**
     * The total number of completion options available. This can exceed the number of values actually sent in the response.
     */
    total?: number;
    /**
     * Indicates whether there are additional completion options beyond those provided in the current response, even if the exact total is unknown.
     */
    hasMore?: boolean;
  };
}

/**
 * A successful response from the server for a {@link CompleteRequest | completion/complete} request.
 *
 * @example Completion result response
 * {@includeCode ./examples/CompleteResultResponse/completion-result-response.json}
 *
 * @category `completion/complete`
 */
export interface CompleteResultResponse extends JSONRPCResultResponse {
  result: CompleteResult;
}

/**
 * A reference to a resource or resource template definition.
 *
 * @category `completion/complete`
 */
export interface ResourceTemplateReference {
  type: "ref/resource";
  /**
   * The URI or URI template of the resource.
   *
   * @format uri-template
   */
  uri: string;
}

/**
 * Identifies a prompt.
 *
 * @category `completion/complete`
 */
export interface PromptReference extends BaseMetadata {
  type: "ref/prompt";
}

/* Roots */
/**
 * Sent from the server to request a list of root URIs from the client. Roots allow
 * servers to ask for specific directories or files to operate on. A common example
 * for roots is providing a set of repositories or directories a server should operate
 * on.
 *
 * This request is typically used when the server needs to understand the file system
 * structure or access specific locations that the client has permission to read from.
 *
 * @example List roots request
 * {@includeCode ./examples/ListRootsRequest/list-roots-request.json}
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category `roots/list`
 */
export interface ListRootsRequest {
  method: "roots/list";
  params?: {
    _meta?: MetaObject;
  };
}

/**
 * The result returned by the client for a {@link ListRootsRequest | roots/list} request.
 * This result contains an array of {@link Root} objects, each representing a root directory
 * or file that the server can operate on.
 *
 * @example Single root directory
 * {@includeCode ./examples/ListRootsResult/single-root-directory.json}
 *
 * @example Multiple root directories
 * {@includeCode ./examples/ListRootsResult/multiple-root-directories.json}
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category `roots/list`
 */
export interface ListRootsResult {
  roots: Root[];
}

/**
 * Represents a root directory or file that the server can operate on.
 *
 * @example Project directory root
 * {@includeCode ./examples/Root/project-directory.json}
 *
 * @deprecated Deprecated as of protocol version 2026-07-28 (SEP-2577).
 * Remains in the specification for at least twelve months; see the
 * deprecated features registry.
 *
 * @category `roots/list`
 */
export interface Root {
  /**
   * The URI identifying the root. This *must* start with `file://` for now.
   * This restriction may be relaxed in future versions of the protocol to allow
   * other URI schemes.
   *
   * @format uri
   */
  uri: string;
  /**
   * An optional name for the root. This can be used to provide a human-readable
   * identifier for the root, which may be useful for display purposes or for
   * referencing the root in other parts of the application.
   */
  name?: string;

  _meta?: MetaObject;
}

/**
 * The parameters for a request to elicit non-sensitive information from the user via a form in the client.
 *
 * @example Elicit single field
 * {@includeCode ./examples/ElicitRequestFormParams/elicit-single-field.json}
 *
 * @example Elicit multiple fields
 * {@includeCode ./examples/ElicitRequestFormParams/elicit-multiple-fields.json}
 *
 * @category `elicitation/create`
 */
export interface ElicitRequestFormParams {
  /**
   * The elicitation mode.
   */
  mode?: "form";

  /**
   * The message to present to the user describing what information is being requested.
   */
  message: string;

  /**
   * A restricted subset of JSON Schema.
   * Only top-level properties are allowed, without nesting.
   */
  requestedSchema: {
    $schema?: string;
    type: "object";
    properties: {
      [key: string]: PrimitiveSchemaDefinition;
    };
    required?: string[];
  };
}

/**
 * The parameters for a request to elicit information from the user via a URL in the client.
 *
 * @example Elicit sensitive data
 * {@includeCode ./examples/ElicitRequestURLParams/elicit-sensitive-data.json}
 *
 * @category `elicitation/create`
 */
export interface ElicitRequestURLParams {
  /**
   * The elicitation mode.
   */
  mode: "url";

  /**
   * The message to present to the user explaining why the interaction is needed.
   */
  message: string;

  /**
   * The URL that the user should navigate to.
   *
   * @format uri
   */
  url: string;
}

/**
 * The parameters for a request to elicit additional information from the user via the client.
 *
 * @category `elicitation/create`
 */
export type ElicitRequestParams =
  ElicitRequestFormParams | ElicitRequestURLParams;

/**
 * A request from the server to elicit additional information from the user via the client.
 *
 * @example Elicitation request
 * {@includeCode ./examples/ElicitRequest/elicitation-request.json}
 *
 * @category `elicitation/create`
 */
export interface ElicitRequest {
  method: "elicitation/create";
  params: ElicitRequestParams;
}

/**
 * Restricted schema definitions that only allow primitive types
 * without nested objects or arrays.
 *
 * @category `elicitation/create`
 */
export type PrimitiveSchemaDefinition =
  StringSchema | NumberSchema | BooleanSchema | EnumSchema;

/**
 * @example Email input schema
 * {@includeCode ./examples/StringSchema/email-input-schema.json}
 *
 * @category `elicitation/create`
 */
export interface StringSchema {
  type: "string";
  title?: string;
  description?: string;
  minLength?: number;
  maxLength?: number;
  format?: "email" | "uri" | "date" | "date-time";
  default?: string;
}

/**
 * @example Number input schema
 * {@includeCode ./examples/NumberSchema/number-input-schema.json}
 *
 * @category `elicitation/create`
 */
export interface NumberSchema {
  type: "number" | "integer";
  title?: string;
  description?: string;
  /**
   * @TJS-type number
   */
  minimum?: number;
  /**
   * @TJS-type number
   */
  maximum?: number;
  /**
   * @TJS-type number
   */
  default?: number;
}

/**
 * @example Boolean input schema
 * {@includeCode ./examples/BooleanSchema/boolean-input-schema.json}
 *
 * @category `elicitation/create`
 */
export interface BooleanSchema {
  type: "boolean";
  title?: string;
  description?: string;
  default?: boolean;
}

/**
 * Schema for single-selection enumeration without display titles for options.
 *
 * @example Color select schema
 * {@includeCode ./examples/UntitledSingleSelectEnumSchema/color-select-schema.json}
 *
 * @category `elicitation/create`
 */
export interface UntitledSingleSelectEnumSchema {
  type: "string";
  /**
   * Optional title for the enum field.
   */
  title?: string;
  /**
   * Optional description for the enum field.
   */
  description?: string;
  /**
   * Array of enum values to choose from.
   */
  enum: string[];
  /**
   * Optional default value.
   */
  default?: string;
}

/**
 * Schema for single-selection enumeration with display titles for each option.
 *
 * @example Titled color select schema
 * {@includeCode ./examples/TitledSingleSelectEnumSchema/titled-color-select-schema.json}
 *
 * @category `elicitation/create`
 */
export interface TitledSingleSelectEnumSchema {
  type: "string";
  /**
   * Optional title for the enum field.
   */
  title?: string;
  /**
   * Optional description for the enum field.
   */
  description?: string;
  /**
   * Array of enum options with values and display labels.
   */
  oneOf: Array<{
    /**
     * The enum value.
     */
    const: string;
    /**
     * Display label for this option.
     */
    title: string;
  }>;
  /**
   * Optional default value.
   */
  default?: string;
}

/**
 * @category `elicitation/create`
 */
// Combined single selection enumeration
export type SingleSelectEnumSchema =
  UntitledSingleSelectEnumSchema | TitledSingleSelectEnumSchema;

/**
 * Schema for multiple-selection enumeration without display titles for options.
 *
 * @example Color multi-select schema
 * {@includeCode ./examples/UntitledMultiSelectEnumSchema/color-multi-select-schema.json}
 *
 * @category `elicitation/create`
 */
export interface UntitledMultiSelectEnumSchema {
  type: "array";
  /**
   * Optional title for the enum field.
   */
  title?: string;
  /**
   * Optional description for the enum field.
   */
  description?: string;
  /**
   * Minimum number of items to select.
   */
  minItems?: number;
  /**
   * Maximum number of items to select.
   */
  maxItems?: number;
  /**
   * Schema for the array items.
   */
  items: {
    type: "string";
    /**
     * Array of enum values to choose from.
     */
    enum: string[];
  };
  /**
   * Optional default value.
   */
  default?: string[];
}

/**
 * Schema for multiple-selection enumeration with display titles for each option.
 *
 * @example Titled color multi-select schema
 * {@includeCode ./examples/TitledMultiSelectEnumSchema/titled-color-multi-select-schema.json}
 *
 * @category `elicitation/create`
 */
export interface TitledMultiSelectEnumSchema {
  type: "array";
  /**
   * Optional title for the enum field.
   */
  title?: string;
  /**
   * Optional description for the enum field.
   */
  description?: string;
  /**
   * Minimum number of items to select.
   */
  minItems?: number;
  /**
   * Maximum number of items to select.
   */
  maxItems?: number;
  /**
   * Schema for array items with enum options and display labels.
   */
  items: {
    /**
     * Array of enum options with values and display labels.
     */
    anyOf: Array<{
      /**
       * The constant enum value.
       */
      const: string;
      /**
       * Display title for this option.
       */
      title: string;
    }>;
  };
  /**
   * Optional default value.
   */
  default?: string[];
}

/**
 * @category `elicitation/create`
 */
// Combined multiple selection enumeration
export type MultiSelectEnumSchema =
  UntitledMultiSelectEnumSchema | TitledMultiSelectEnumSchema;

/**
 * Use {@link TitledSingleSelectEnumSchema} instead.
 * This interface will be removed in a future version.
 *
 * @category `elicitation/create`
 */
export interface LegacyTitledEnumSchema {
  type: "string";
  title?: string;
  description?: string;
  enum: string[];
  /**
   * (Legacy) Display names for enum values.
   * Non-standard according to JSON schema 2020-12.
   */
  enumNames?: string[];
  default?: string;
}

/**
 * @category `elicitation/create`
 */
// Union type for all enum schemas
export type EnumSchema =
  SingleSelectEnumSchema | MultiSelectEnumSchema | LegacyTitledEnumSchema;

/**
 * The result returned by the client for an {@link ElicitRequest| elicitation/create} request.
 *
 * @example Input single field
 * {@includeCode ./examples/ElicitResult/input-single-field.json}
 *
 * @example Input multiple fields
 * {@includeCode ./examples/ElicitResult/input-multiple-fields.json}
 *
 * @example Accept URL mode (no content)
 * {@includeCode ./examples/ElicitResult/accept-url-mode-no-content.json}
 *
 * @category `elicitation/create`
 */
export interface ElicitResult {
  /**
   * The user action in response to the elicitation.
   * - `"accept"`: User submitted the form/confirmed the action
   * - `"decline"`: User explicitly declined the action
   * - `"cancel"`: User dismissed without making an explicit choice
   */
  action: "accept" | "decline" | "cancel";

  /**
   * The submitted form data, only present when action is `"accept"` and mode was `"form"`.
   * Contains values matching the requested schema.
   * Omitted for out-of-band mode responses.
   */
  content?: { [key: string]: string | number | boolean | string[] };
}

```
