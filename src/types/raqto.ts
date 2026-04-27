// Raqto受発注 DB types (hand-written, matches actual external database schema)

export interface RaqtoCompany {
  id: string;
  name: string;
  postal_code: string | null;
  address: string | null;
  telephone: string | null;
  invoice_registration_number: string | null;
  created_at: string;
}

export interface RaqtoCompanyMember {
  id: string;
  company_id: string;
  auth_user_id: string;
  display_name: string | null;
  role: string;
  created_at: string;
}

export interface RaqtoPartner {
  id: string;
  company_id: string;
  name: string;
  postal_code: string | null;
  address: string | null;
  telephone: string | null;
  email: string | null;
  invoice_registration_number: string | null;
  contact_person: string | null;
  status: string | null;
  created_at: string;
}

export interface RaqtoOrder {
  id: string;
  company_id: string;
  partner_id: string;
  order_type: string | null; // "sales_order" | "purchase_order"
  order_number: string;
  order_date: string;
  payment_due_date: string | null;
  status: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  notes: string | null;
  created_at: string;
}

export interface RaqtoOrderItem {
  id: string;
  order_id: string;
  product_id: string | null;
  item_name: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  subtotal: number;
  tax_amount: number;
}

export interface RaqtoDocument {
  id: string;
  company_id: string;
  partner_id: string;
  order_id: string | null;
  document_type: string; // 'invoice', 'quote', etc.
  document_number: string;
  issued_date: string;
  due_date: string | null;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: string;
  notes: string | null;
  created_at: string;
}

export interface RaqtoDocumentItem {
  id: string;
  document_id: string;
  sort_order: number;
  item_name: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  subtotal: number;
  tax_amount: number;
}
