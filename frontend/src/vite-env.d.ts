/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DIOSC_HUB_URL?: string;
  readonly VITE_DIOSC_EMBED_KEY?: string;
  readonly VITE_DIOSC_ASSISTANT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// The DioscHub assistant web component (upgraded by the embed loader script).
declare namespace JSX {
  interface IntrinsicElements {
    'diosc-chat': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        mode?: string;
        'api-key'?: string;
        'backend-url'?: string;
        'assistant-id'?: string;
        'bind-endpoint'?: string;
      },
      HTMLElement
    >;
  }
}
