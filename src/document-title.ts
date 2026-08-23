export const BASE_DOCUMENT_TITLE = "Pullsmith";

export function documentTitle(customerName?: string | null) {
  const name = customerName?.trim();
  return name ? `${name} — ${BASE_DOCUMENT_TITLE}` : BASE_DOCUMENT_TITLE;
}
