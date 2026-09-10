// Auto-generated types from Supabase schema (001_initial_schema.sql)
// These types provide type-safety for Supabase client queries.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// 損益計算書（報告式・5段階利益）の表示区分
export type PlClassification =
  | "sales"               // 売上高
  | "cogs"                // 売上原価
  | "sga"                 // 販売費及び一般管理費
  | "non_op_revenue"      // 営業外収益
  | "non_op_expense"      // 営業外費用
  | "extraordinary_gain"  // 特別利益
  | "extraordinary_loss"  // 特別損失
  | "tax";                // 法人税等

export interface Database {
  public: {
    Tables: {
      super_admins: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          email: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          email: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          email?: string;
          is_active?: boolean;
        };
        Relationships: [];
      };
      firms: {
        Row: {
          id: string;
          name: string;
          postal_code: string | null;
          address: string | null;
          telephone: string | null;
          email: string | null;
          invoice_registration_number: string | null;
          created_at: string;
          updated_at: string;
          is_self_service: boolean;
        };
        Insert: {
          id?: string;
          name: string;
          postal_code?: string | null;
          address?: string | null;
          telephone?: string | null;
          email?: string | null;
          invoice_registration_number?: string | null;
          is_self_service?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          postal_code?: string | null;
          address?: string | null;
          telephone?: string | null;
          email?: string | null;
          invoice_registration_number?: string | null;
          is_self_service?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      firm_members: {
        Row: {
          id: string;
          firm_id: string;
          user_id: string;
          name: string;
          email: string;
          role: "admin" | "staff";
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          firm_id: string;
          user_id: string;
          name: string;
          email: string;
          role: "admin" | "staff";
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          firm_id?: string;
          user_id?: string;
          name?: string;
          email?: string;
          role?: "admin" | "staff";
          is_active?: boolean;
        };
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          firm_id: string | null;
          name: string;
          business_type: string | null;
          postal_code: string | null;
          address: string | null;
          telephone: string | null;
          email: string | null;
          fiscal_year_start_month: number;
          /** 給料日。1〜31 はその日にち、0 は末日、NULL は未設定 */
          payday: number | null;
          tax_method: "standard" | "simplified";
          simplified_business_type: number | null;
          invoice_registration_number: string | null;
          entity_type: "individual" | "corporation" | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          firm_id?: string | null;
          name: string;
          business_type?: string | null;
          postal_code?: string | null;
          address?: string | null;
          telephone?: string | null;
          email?: string | null;
          fiscal_year_start_month?: number;
          payday?: number | null;
          tax_method?: "standard" | "simplified";
          simplified_business_type?: number | null;
          invoice_registration_number?: string | null;
          entity_type?: "individual" | "corporation" | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          firm_id?: string | null;
          name?: string;
          business_type?: string | null;
          postal_code?: string | null;
          address?: string | null;
          telephone?: string | null;
          email?: string | null;
          fiscal_year_start_month?: number;
          payday?: number | null;
          tax_method?: "standard" | "simplified";
          simplified_business_type?: number | null;
          invoice_registration_number?: string | null;
          entity_type?: "individual" | "corporation" | null;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      client_users: {
        Row: {
          id: string;
          client_id: string;
          user_id: string;
          name: string;
          email: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          user_id: string;
          name: string;
          email: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          user_id?: string;
          name?: string;
          email?: string;
          is_active?: boolean;
        };
        Relationships: [];
      };
      account_categories: {
        Row: {
          id: string;
          type: "assets" | "liabilities" | "equity" | "revenue" | "expenses";
          name: string;
          sort_order: number;
        };
        Insert: {
          id?: string;
          type: "assets" | "liabilities" | "equity" | "revenue" | "expenses";
          name: string;
          sort_order?: number;
        };
        Update: {
          id?: string;
          type?: "assets" | "liabilities" | "equity" | "revenue" | "expenses";
          name?: string;
          sort_order?: number;
        };
        Relationships: [];
      };
      accounts: {
        Row: {
          id: string;
          client_id: string | null;
          category_id: string;
          code: string;
          name: string;
          is_active: boolean;
          is_default: boolean;
          pl_classification: PlClassification | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id?: string | null;
          category_id: string;
          code: string;
          name: string;
          is_active?: boolean;
          is_default?: boolean;
          pl_classification?: PlClassification | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string | null;
          category_id?: string;
          code?: string;
          name?: string;
          is_active?: boolean;
          is_default?: boolean;
          pl_classification?: PlClassification | null;
        };
        Relationships: [];
      };
      inventory_counts: {
        Row: {
          id: string;
          client_id: string;
          count_date: string;
          product_name: string;
          quantity: number;
          unit_price: number;
          amount: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          count_date: string;
          product_name: string;
          quantity?: number;
          unit_price?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          count_date?: string;
          product_name?: string;
          quantity?: number;
          unit_price?: number;
        };
        Relationships: [];
      };
      account_readings: {
        Row: {
          id: string;
          name: string;
          reading: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          reading: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          reading?: string;
        };
        Relationships: [];
      };
      allocation_rate_settings: {
        Row: {
          id: string;
          client_id: string;
          fiscal_year: number;
          account_id: string;
          business_ratio: number;
          basis_note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          fiscal_year: number;
          account_id: string;
          business_ratio?: number;
          basis_note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          fiscal_year?: number;
          account_id?: string;
          business_ratio?: number;
          basis_note?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      sub_accounts: {
        Row: {
          id: string;
          account_id: string;
          name: string;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          account_id: string;
          name: string;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          account_id?: string;
          name?: string;
          is_active?: boolean;
        };
        Relationships: [];
      };
      departments: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          client_id: string;
          name: string;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          client_id?: string;
          name?: string;
          is_active?: boolean;
        };
        Relationships: [];
      };
      tax_categories: {
        Row: {
          id: string;
          code: string;
          name: string;
          rate: number;
          is_purchase: boolean;
          transition_rate: number | null;
        };
        Insert: {
          id?: string;
          code: string;
          name: string;
          rate: number;
          is_purchase?: boolean;
          transition_rate?: number | null;
        };
        Update: {
          id?: string;
          code?: string;
          name?: string;
          rate?: number;
          is_purchase?: boolean;
          transition_rate?: number | null;
        };
        Relationships: [];
      };
      business_partners: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          type: "customer" | "vendor" | "both";
          postal_code: string | null;
          address: string | null;
          telephone: string | null;
          email: string | null;
          invoice_registration_number: string | null;
          is_invoice_registered: boolean;
          raqto_partner_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          name: string;
          type: "customer" | "vendor" | "both";
          postal_code?: string | null;
          address?: string | null;
          telephone?: string | null;
          email?: string | null;
          invoice_registration_number?: string | null;
          is_invoice_registered?: boolean;
          raqto_partner_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          name?: string;
          type?: "customer" | "vendor" | "both";
          postal_code?: string | null;
          address?: string | null;
          telephone?: string | null;
          email?: string | null;
          invoice_registration_number?: string | null;
          is_invoice_registered?: boolean;
          raqto_partner_id?: string | null;
        };
        Relationships: [];
      };
      fiscal_years: {
        Row: {
          id: string;
          client_id: string;
          start_date: string;
          end_date: string;
          status: "open" | "closed" | "locked";
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          start_date: string;
          end_date: string;
          status?: "open" | "closed" | "locked";
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          start_date?: string;
          end_date?: string;
          status?: "open" | "closed" | "locked";
        };
        Relationships: [];
      };
      receipts: {
        Row: {
          id: string;
          client_id: string;
          uploaded_by: string;
          image_path: string;
          payment_method: "cash" | "card" | "e_money" | "bank_transfer" | null;
          status: "uploaded" | "processing" | "ocr_done" | "reviewed" | "journalized";
          direction: "issued" | "received";
          ocr_result: Json | null;
          ai_journal_suggestion: Json | null;
          fiscal_year_id: string | null;
          uploaded_at: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          raqto_source_id: string | null;
          original_filename: string | null;
          file_size: number | null;
          mime_type: string | null;
          file_hash: string | null;
          hash_algorithm: string | null;
          hash_verified_at: string | null;
          document_type: string | null;
          folder_id: string | null;
        };
        Insert: {
          id?: string;
          client_id: string;
          uploaded_by: string;
          image_path: string;
          payment_method?: "cash" | "card" | "e_money" | "bank_transfer" | null;
          status?: "uploaded" | "processing" | "ocr_done" | "reviewed" | "journalized";
          direction?: "issued" | "received";
          ocr_result?: Json | null;
          ai_journal_suggestion?: Json | null;
          fiscal_year_id?: string | null;
          uploaded_at?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          raqto_source_id?: string | null;
          original_filename?: string | null;
          file_size?: number | null;
          mime_type?: string | null;
          file_hash?: string | null;
          hash_algorithm?: string | null;
          hash_verified_at?: string | null;
          document_type?: string | null;
          folder_id?: string | null;
        };
        Update: {
          id?: string;
          client_id?: string;
          uploaded_by?: string;
          image_path?: string;
          payment_method?: "cash" | "card" | "e_money" | "bank_transfer" | null;
          status?: "uploaded" | "processing" | "ocr_done" | "reviewed" | "journalized";
          direction?: "issued" | "received";
          ocr_result?: Json | null;
          ai_journal_suggestion?: Json | null;
          fiscal_year_id?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          raqto_source_id?: string | null;
          original_filename?: string | null;
          file_size?: number | null;
          mime_type?: string | null;
          file_hash?: string | null;
          hash_algorithm?: string | null;
          hash_verified_at?: string | null;
          document_type?: string | null;
          folder_id?: string | null;
        };
        Relationships: [];
      };
      receipt_folders: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          parent_id: string | null;
          sort_order: number;
          created_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          client_id: string;
          name: string;
          parent_id?: string | null;
          sort_order?: number;
          created_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          client_id?: string;
          name?: string;
          parent_id?: string | null;
          sort_order?: number;
          created_by?: string | null;
        };
        Relationships: [];
      };
      statement_lines: {
        Row: {
          id: string;
          receipt_id: string;
          client_id: string;
          line_date: string | null;
          description: string;
          amount: number;
          direction: "deposit" | "withdrawal";
          balance_after: number | null;
          counterparty: string | null;
          journal_entry_id: string | null;
          status: "pending" | "journalized" | "ignored";
          suggested_account_id: string | null;
          sort_order: number;
          raw_data: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          receipt_id: string;
          client_id: string;
          line_date?: string | null;
          description?: string;
          amount?: number;
          direction?: "deposit" | "withdrawal";
          balance_after?: number | null;
          counterparty?: string | null;
          journal_entry_id?: string | null;
          status?: "pending" | "journalized" | "ignored";
          suggested_account_id?: string | null;
          sort_order?: number;
          raw_data?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          receipt_id?: string;
          client_id?: string;
          line_date?: string | null;
          description?: string;
          amount?: number;
          direction?: "deposit" | "withdrawal";
          balance_after?: number | null;
          counterparty?: string | null;
          journal_entry_id?: string | null;
          status?: "pending" | "journalized" | "ignored";
          suggested_account_id?: string | null;
          sort_order?: number;
          raw_data?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      payroll_records: {
        Row: {
          id: string;
          client_id: string;
          pay_month: string;
          pay_date: string | null;
          employee_name: string;
          employee_type: "employee" | "officer";
          gross_salary: number;
          income_tax: number;
          resident_tax: number;
          health_insurance: number;
          pension_insurance: number;
          employment_insurance: number;
          other_deduction: number;
          net_pay: number;
          salary_account_id: string | null;
          withholding_account_id: string | null;
          payment_account_id: string | null;
          journal_entry_id: string | null;
          status: "pending" | "journalized";
          memo: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          pay_month: string;
          pay_date?: string | null;
          employee_name: string;
          employee_type?: "employee" | "officer";
          gross_salary?: number;
          income_tax?: number;
          resident_tax?: number;
          health_insurance?: number;
          pension_insurance?: number;
          employment_insurance?: number;
          other_deduction?: number;
          net_pay?: number;
          salary_account_id?: string | null;
          withholding_account_id?: string | null;
          payment_account_id?: string | null;
          journal_entry_id?: string | null;
          status?: "pending" | "journalized";
          memo?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          pay_month?: string;
          pay_date?: string | null;
          employee_name?: string;
          employee_type?: "employee" | "officer";
          gross_salary?: number;
          income_tax?: number;
          resident_tax?: number;
          health_insurance?: number;
          pension_insurance?: number;
          employment_insurance?: number;
          other_deduction?: number;
          net_pay?: number;
          salary_account_id?: string | null;
          withholding_account_id?: string | null;
          payment_account_id?: string | null;
          journal_entry_id?: string | null;
          status?: "pending" | "journalized";
          memo?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      loans: {
        Row: {
          id: string;
          client_id: string;
          lender_name: string;
          loan_type: "borrowing" | "officer";
          direction: "borrow" | "lend";
          counterparty_kind: "institution" | "officer";
          business_partner_id: string | null;
          repayment_terms: string | null;
          purpose: string | null;
          principal: number;
          current_balance: number;
          interest_rate: number | null;
          /** @deprecated 044 で廃止。増減明細の日付を使う */
          borrowed_date?: string | null;
          liability_account_id: string | null;
          status: "active" | "completed";
          memo: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          lender_name: string;
          loan_type?: "borrowing" | "officer";
          direction?: "borrow" | "lend";
          counterparty_kind?: "institution" | "officer";
          business_partner_id?: string | null;
          repayment_terms?: string | null;
          purpose?: string | null;
          principal?: number;
          current_balance?: number;
          interest_rate?: number | null;
          borrowed_date?: string | null;
          liability_account_id?: string | null;
          status?: "active" | "completed";
          memo?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          lender_name?: string;
          loan_type?: "borrowing" | "officer";
          direction?: "borrow" | "lend";
          counterparty_kind?: "institution" | "officer";
          business_partner_id?: string | null;
          repayment_terms?: string | null;
          purpose?: string | null;
          principal?: number;
          current_balance?: number;
          interest_rate?: number | null;
          borrowed_date?: string | null;
          liability_account_id?: string | null;
          status?: "active" | "completed";
          memo?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      loan_entries: {
        Row: {
          id: string;
          loan_id: string;
          client_id: string;
          entry_date: string;
          entry_type: "borrow" | "advance" | "repay" | "interest" | "adjust";
          amount: number;
          signed_adjustment: number | null;
          interest_amount: number;
          expense_account_id: string | null;
          payment_account_id: string | null;
          journal_entry_id: string | null;
          status: "draft" | "confirmed" | "journalized";
          source: "manual" | "ai_draft";
          ai_evidence: Json | null;
          memo: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          loan_id: string;
          client_id: string;
          entry_date: string;
          entry_type: "borrow" | "advance" | "repay" | "interest" | "adjust";
          amount: number;
          signed_adjustment?: number | null;
          interest_amount?: number;
          expense_account_id?: string | null;
          payment_account_id?: string | null;
          journal_entry_id?: string | null;
          status?: "draft" | "confirmed" | "journalized";
          source?: "manual" | "ai_draft";
          ai_evidence?: Json | null;
          memo?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          loan_id?: string;
          client_id?: string;
          entry_date?: string;
          entry_type?: "borrow" | "advance" | "repay" | "interest" | "adjust";
          amount?: number;
          signed_adjustment?: number | null;
          interest_amount?: number;
          expense_account_id?: string | null;
          payment_account_id?: string | null;
          journal_entry_id?: string | null;
          status?: "draft" | "confirmed" | "journalized";
          source?: "manual" | "ai_draft";
          ai_evidence?: Json | null;
          memo?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      loan_entry_receipts: {
        Row: {
          id: string;
          loan_entry_id: string;
          receipt_id: string;
          client_id: string;
          source_line_no: number | null;
          source_note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          loan_entry_id: string;
          receipt_id: string;
          client_id: string;
          source_line_no?: number | null;
          source_note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          loan_entry_id?: string;
          receipt_id?: string;
          client_id?: string;
          source_line_no?: number | null;
          source_note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      loan_repayment_schedules: {
        Row: {
          id: string;
          loan_id: string;
          client_id: string;
          due_date: string;
          principal_amount: number;
          interest_amount: number;
          principal_entry_id: string | null;
          interest_entry_id: string | null;
          memo: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          loan_id: string;
          client_id: string;
          due_date: string;
          principal_amount?: number;
          interest_amount?: number;
          principal_entry_id?: string | null;
          interest_entry_id?: string | null;
          memo?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          loan_id?: string;
          client_id?: string;
          due_date?: string;
          principal_amount?: number;
          interest_amount?: number;
          principal_entry_id?: string | null;
          interest_entry_id?: string | null;
          memo?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      statutory_interest_rates: {
        Row: {
          loan_year: number;
          rate: number;
          note: string | null;
          updated_at: string;
        };
        Insert: {
          loan_year: number;
          rate: number;
          note?: string | null;
          updated_at?: string;
        };
        Update: {
          loan_year?: number;
          rate?: number;
          note?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      loan_repayments: {
        Row: {
          id: string;
          loan_id: string;
          client_id: string;
          repayment_date: string;
          principal_amount: number;
          interest_amount: number;
          payment_account_id: string | null;
          interest_account_id: string | null;
          journal_entry_id: string | null;
          status: "pending" | "journalized";
          memo: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          loan_id: string;
          client_id: string;
          repayment_date: string;
          principal_amount?: number;
          interest_amount?: number;
          payment_account_id?: string | null;
          interest_account_id?: string | null;
          journal_entry_id?: string | null;
          status?: "pending" | "journalized";
          memo?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          loan_id?: string;
          client_id?: string;
          repayment_date?: string;
          principal_amount?: number;
          interest_amount?: number;
          payment_account_id?: string | null;
          interest_account_id?: string | null;
          journal_entry_id?: string | null;
          status?: "pending" | "journalized";
          memo?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      company_documents: {
        Row: {
          id: string;
          client_id: string;
          doc_type: "articles" | "registry" | "tax_filing" | "license" | "other";
          title: string;
          file_path: string;
          original_filename: string | null;
          file_size: number | null;
          mime_type: string | null;
          file_hash: string | null;
          hash_algorithm: string | null;
          issued_date: string | null;
          memo: string | null;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          doc_type?: "articles" | "registry" | "tax_filing" | "license" | "other";
          title: string;
          file_path: string;
          original_filename?: string | null;
          file_size?: number | null;
          mime_type?: string | null;
          file_hash?: string | null;
          hash_algorithm?: string | null;
          issued_date?: string | null;
          memo?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          doc_type?: "articles" | "registry" | "tax_filing" | "license" | "other";
          title?: string;
          file_path?: string;
          original_filename?: string | null;
          file_size?: number | null;
          mime_type?: string | null;
          file_hash?: string | null;
          hash_algorithm?: string | null;
          issued_date?: string | null;
          memo?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      journal_entries: {
        Row: {
          id: string;
          client_id: string;
          entry_date: string;
          description: string | null;
          status: "draft" | "confirmed" | "locked";
          source: "manual" | "ai" | "import" | "raqto" | "bank" | "closing" | "card" | "payment" | "loan";
          receipt_id: string | null;
          raqto_source_id: string | null;
          metadata: Json | null;
          needs_review: boolean;
          review_status: "unreviewed" | "confirmed" | "needs_fix" | "question";
          review_note: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          entry_date: string;
          description?: string | null;
          status?: "draft" | "confirmed" | "locked";
          source?: "manual" | "ai" | "import" | "raqto" | "bank" | "closing" | "card" | "payment" | "loan";
          receipt_id?: string | null;
          raqto_source_id?: string | null;
          metadata?: Json | null;
          needs_review?: boolean;
          review_status?: "unreviewed" | "confirmed" | "needs_fix" | "question";
          review_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          entry_date?: string;
          description?: string | null;
          status?: "draft" | "confirmed" | "locked";
          source?: "manual" | "ai" | "import" | "raqto" | "bank" | "closing" | "card" | "payment" | "loan";
          receipt_id?: string | null;
          raqto_source_id?: string | null;
          metadata?: Json | null;
          needs_review?: boolean;
          review_status?: "unreviewed" | "confirmed" | "needs_fix" | "question";
          review_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          created_by?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "journal_entries_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journal_entries_receipt_id_fkey";
            columns: ["receipt_id"];
            isOneToOne: false;
            referencedRelation: "receipts";
            referencedColumns: ["id"];
          },
        ];
      };
      journal_entry_lines: {
        Row: {
          id: string;
          journal_entry_id: string;
          account_id: string;
          sub_account_id: string | null;
          department_id: string | null;
          debit_amount: number;
          credit_amount: number;
          tax_category: string | null;
          tax_rate: number | null;
          sort_order: number;
        };
        Insert: {
          id?: string;
          journal_entry_id: string;
          account_id: string;
          sub_account_id?: string | null;
          department_id?: string | null;
          debit_amount?: number;
          credit_amount?: number;
          tax_category?: string | null;
          tax_rate?: number | null;
          sort_order?: number;
        };
        Update: {
          id?: string;
          journal_entry_id?: string;
          account_id?: string;
          sub_account_id?: string | null;
          department_id?: string | null;
          debit_amount?: number;
          credit_amount?: number;
          tax_category?: string | null;
          tax_rate?: number | null;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "journal_entry_lines_journal_entry_id_fkey";
            columns: ["journal_entry_id"];
            isOneToOne: false;
            referencedRelation: "journal_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "journal_entry_lines_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      journal_templates: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          template_data: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          name: string;
          template_data?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          name?: string;
          template_data?: Json;
        };
        Relationships: [];
      };
      ai_journal_patterns: {
        Row: {
          id: string;
          client_id: string;
          vendor_name: string | null;
          keyword: string | null;
          account_id: string;
          sub_account_id: string | null;
          tax_category: string | null;
          confidence: number;
          usage_count: number;
          last_used_at: string | null;
          direction: string | null;
          counter_account_id: string | null;
          tax_rate: number | null;
        };
        Insert: {
          id?: string;
          client_id: string;
          vendor_name?: string | null;
          keyword?: string | null;
          account_id: string;
          sub_account_id?: string | null;
          tax_category?: string | null;
          confidence?: number;
          usage_count?: number;
          last_used_at?: string | null;
          direction?: string | null;
          counter_account_id?: string | null;
          tax_rate?: number | null;
        };
        Update: {
          id?: string;
          client_id?: string;
          vendor_name?: string | null;
          keyword?: string | null;
          account_id?: string;
          sub_account_id?: string | null;
          tax_category?: string | null;
          confidence?: number;
          usage_count?: number;
          last_used_at?: string | null;
          direction?: string | null;
          counter_account_id?: string | null;
          tax_rate?: number | null;
        };
        Relationships: [];
      };
      invoices: {
        Row: {
          id: string;
          client_id: string;
          business_partner_id: string;
          invoice_number: string;
          issued_date: string;
          due_date: string | null;
          subtotal: number;
          tax_amount: number;
          total_amount: number;
          status: "draft" | "issued" | "sent" | "paid" | "overdue" | "void";
          direction: "sales" | "purchase";
          pdf_storage_path: string | null;
          journal_entry_id: string | null;
          raqto_source_id: string | null;
          raqto_source_type: string | null;
          raqto_order_status: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          business_partner_id: string;
          invoice_number: string;
          issued_date: string;
          due_date?: string | null;
          subtotal?: number;
          tax_amount?: number;
          total_amount?: number;
          status?: "draft" | "issued" | "sent" | "paid" | "overdue" | "void";
          direction?: "sales" | "purchase";
          pdf_storage_path?: string | null;
          journal_entry_id?: string | null;
          raqto_source_id?: string | null;
          raqto_source_type?: string | null;
          raqto_order_status?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          business_partner_id?: string;
          invoice_number?: string;
          issued_date?: string;
          due_date?: string | null;
          subtotal?: number;
          tax_amount?: number;
          total_amount?: number;
          status?: "draft" | "issued" | "sent" | "paid" | "overdue" | "void";
          direction?: "sales" | "purchase";
          pdf_storage_path?: string | null;
          journal_entry_id?: string | null;
          raqto_source_id?: string | null;
          raqto_source_type?: string | null;
          raqto_order_status?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      invoice_items: {
        Row: {
          id: string;
          invoice_id: string;
          sort_order: number;
          item_name: string;
          quantity: number;
          unit_price: number;
          tax_rate: number;
          subtotal: number;
          tax_amount: number;
          transaction_date: string | null;
        };
        Insert: {
          id?: string;
          invoice_id: string;
          sort_order?: number;
          item_name: string;
          quantity?: number;
          unit_price?: number;
          tax_rate?: number;
          subtotal?: number;
          tax_amount?: number;
          transaction_date?: string | null;
        };
        Update: {
          id?: string;
          invoice_id?: string;
          sort_order?: number;
          item_name?: string;
          quantity?: number;
          unit_price?: number;
          tax_rate?: number;
          subtotal?: number;
          tax_amount?: number;
          transaction_date?: string | null;
        };
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          client_id: string;
          business_partner_id: string;
          amount: number;
          payment_date: string;
          payment_method: string | null;
          bank_account: string | null;
          memo: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          business_partner_id: string;
          amount?: number;
          payment_date: string;
          payment_method?: string | null;
          bank_account?: string | null;
          memo?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          business_partner_id?: string;
          amount?: number;
          payment_date?: string;
          payment_method?: string | null;
          bank_account?: string | null;
          memo?: string | null;
        };
        Relationships: [];
      };
      payment_allocations: {
        Row: {
          id: string;
          payment_id: string;
          invoice_id: string;
          allocated_amount: number;
        };
        Insert: {
          id?: string;
          payment_id: string;
          invoice_id: string;
          allocated_amount?: number;
        };
        Update: {
          id?: string;
          payment_id?: string;
          invoice_id?: string;
          allocated_amount?: number;
        };
        Relationships: [];
      };
      fixed_assets: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          category: string | null;
          acquisition_date: string;
          acquisition_cost: number;
          useful_life: number;
          depreciation_method: "straight_line" | "declining_balance";
          salvage_value: number;
          disposed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          name: string;
          category?: string | null;
          acquisition_date: string;
          acquisition_cost?: number;
          useful_life: number;
          depreciation_method: "straight_line" | "declining_balance";
          salvage_value?: number;
          disposed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          name?: string;
          category?: string | null;
          acquisition_date?: string;
          acquisition_cost?: number;
          useful_life?: number;
          depreciation_method?: "straight_line" | "declining_balance";
          salvage_value?: number;
          disposed_at?: string | null;
        };
        Relationships: [];
      };
      closing_balances: {
        Row: {
          id: string;
          fiscal_year_id: string;
          account_id: string;
          balance: number;
        };
        Insert: {
          id?: string;
          fiscal_year_id: string;
          account_id: string;
          balance?: number;
        };
        Update: {
          id?: string;
          fiscal_year_id?: string;
          account_id?: string;
          balance?: number;
        };
        Relationships: [];
      };
      comments: {
        Row: {
          id: string;
          receipt_id: string | null;
          journal_entry_id: string | null;
          parent_id: string | null;
          author_id: string;
          author_role: "staff" | "client";
          body: string;
          status: "open" | "answered" | "resolved";
          created_at: string;
        };
        Insert: {
          id?: string;
          receipt_id?: string | null;
          journal_entry_id?: string | null;
          parent_id?: string | null;
          author_id: string;
          author_role: "staff" | "client";
          body: string;
          status?: "open" | "answered" | "resolved";
          created_at?: string;
        };
        Update: {
          id?: string;
          receipt_id?: string | null;
          journal_entry_id?: string | null;
          parent_id?: string | null;
          author_id?: string;
          author_role?: "staff" | "client";
          body?: string;
          status?: "open" | "answered" | "resolved";
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          body: string | null;
          is_read: boolean;
          link: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          body?: string | null;
          is_read?: boolean;
          link?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          body?: string | null;
          is_read?: boolean;
          link?: string | null;
        };
        Relationships: [];
      };
      submission_schedules: {
        Row: {
          id: string;
          client_id: string;
          frequency: "monthly" | "weekly";
          due_day: number;
          reminder_days: Json;
          notification_methods: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          frequency: "monthly" | "weekly";
          due_day: number;
          reminder_days?: Json;
          notification_methods?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          frequency?: "monthly" | "weekly";
          due_day?: number;
          reminder_days?: Json;
          notification_methods?: Json;
        };
        Relationships: [];
      };
      bank_accounts: {
        Row: {
          id: string;
          client_id: string;
          bank_name: string;
          branch_name: string | null;
          account_type: "ordinary" | "checking" | "savings";
          account_number: string;
          account_holder: string | null;
          account_id: string | null;
          provider: "manual" | "moneytree" | "moneyforward" | "zaim";
          provider_account_id: string | null;
          is_active: boolean;
          last_synced_at: string | null;
          sync_status: "idle" | "syncing" | "error" | "success";
          settings: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          bank_name: string;
          branch_name?: string | null;
          account_type?: "ordinary" | "checking" | "savings";
          account_number: string;
          account_holder?: string | null;
          account_id?: string | null;
          provider?: "manual" | "moneytree" | "moneyforward" | "zaim";
          provider_account_id?: string | null;
          is_active?: boolean;
          last_synced_at?: string | null;
          sync_status?: "idle" | "syncing" | "error" | "success";
          settings?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          bank_name?: string;
          branch_name?: string | null;
          account_type?: "ordinary" | "checking" | "savings";
          account_number?: string;
          account_holder?: string | null;
          account_id?: string | null;
          provider?: "manual" | "moneytree" | "moneyforward" | "zaim";
          provider_account_id?: string | null;
          is_active?: boolean;
          last_synced_at?: string | null;
          sync_status?: "idle" | "syncing" | "error" | "success";
          settings?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bank_accounts_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bank_accounts_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      bank_transactions: {
        Row: {
          id: string;
          bank_account_id: string;
          transaction_date: string;
          description: string;
          amount: number;
          balance_after: number | null;
          transaction_type: "deposit" | "withdrawal";
          counterparty: string | null;
          reference_number: string | null;
          journal_entry_id: string | null;
          match_status: "unmatched" | "matched" | "ignored";
          match_confidence: number | null;
          suggested_account_id: string | null;
          raw_data: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          bank_account_id: string;
          transaction_date: string;
          description: string;
          amount: number;
          balance_after?: number | null;
          transaction_type: "deposit" | "withdrawal";
          counterparty?: string | null;
          reference_number?: string | null;
          journal_entry_id?: string | null;
          match_status?: "unmatched" | "matched" | "ignored";
          match_confidence?: number | null;
          suggested_account_id?: string | null;
          raw_data?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          bank_account_id?: string;
          transaction_date?: string;
          description?: string;
          amount?: number;
          balance_after?: number | null;
          transaction_type?: "deposit" | "withdrawal";
          counterparty?: string | null;
          reference_number?: string | null;
          journal_entry_id?: string | null;
          match_status?: "unmatched" | "matched" | "ignored";
          match_confidence?: number | null;
          suggested_account_id?: string | null;
          raw_data?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "bank_transactions_bank_account_id_fkey";
            columns: ["bank_account_id"];
            isOneToOne: false;
            referencedRelation: "bank_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bank_transactions_journal_entry_id_fkey";
            columns: ["journal_entry_id"];
            isOneToOne: false;
            referencedRelation: "journal_entries";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bank_transactions_suggested_account_id_fkey";
            columns: ["suggested_account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      card_accounts: {
        Row: {
          id: string;
          client_id: string;
          card_company: "VISA" | "Master" | "JCB" | "AMEX" | "Diners" | "UnionPay" | "other";
          card_name: string;
          card_number_masked: string;
          card_holder: string | null;
          closing_day: number;
          payment_day: number;
          linked_bank_account_id: string | null;
          payable_account_id: string | null;
          provider: "manual" | "moneytree" | "moneyforward" | "zaim";
          provider_account_id: string | null;
          is_active: boolean;
          last_synced_at: string | null;
          sync_status: "idle" | "syncing" | "error" | "success";
          settings: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          card_company: "VISA" | "Master" | "JCB" | "AMEX" | "Diners" | "UnionPay" | "other";
          card_name: string;
          card_number_masked: string;
          card_holder?: string | null;
          closing_day: number;
          payment_day: number;
          linked_bank_account_id?: string | null;
          payable_account_id?: string | null;
          provider?: "manual" | "moneytree" | "moneyforward" | "zaim";
          provider_account_id?: string | null;
          is_active?: boolean;
          last_synced_at?: string | null;
          sync_status?: "idle" | "syncing" | "error" | "success";
          settings?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          card_company?: "VISA" | "Master" | "JCB" | "AMEX" | "Diners" | "UnionPay" | "other";
          card_name?: string;
          card_number_masked?: string;
          card_holder?: string | null;
          closing_day?: number;
          payment_day?: number;
          linked_bank_account_id?: string | null;
          payable_account_id?: string | null;
          provider?: "manual" | "moneytree" | "moneyforward" | "zaim";
          provider_account_id?: string | null;
          is_active?: boolean;
          last_synced_at?: string | null;
          sync_status?: "idle" | "syncing" | "error" | "success";
          settings?: Json | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      card_transactions: {
        Row: {
          id: string;
          card_account_id: string;
          transaction_date: string;
          posted_date: string | null;
          description: string;
          amount: number;
          transaction_type: "charge" | "refund" | "payment" | "fee" | "interest";
          counterparty: string | null;
          installment_type: "lump" | "installment" | "revolving" | "bonus" | null;
          installment_count: number | null;
          foreign_currency: string | null;
          foreign_amount: number | null;
          statement_month: string | null;
          journal_entry_id: string | null;
          match_status: "unmatched" | "matched" | "ignored";
          match_confidence: number | null;
          suggested_account_id: string | null;
          reference_number: string | null;
          raw_data: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          card_account_id: string;
          transaction_date: string;
          posted_date?: string | null;
          description: string;
          amount: number;
          transaction_type?: "charge" | "refund" | "payment" | "fee" | "interest";
          counterparty?: string | null;
          installment_type?: "lump" | "installment" | "revolving" | "bonus" | null;
          installment_count?: number | null;
          foreign_currency?: string | null;
          foreign_amount?: number | null;
          statement_month?: string | null;
          journal_entry_id?: string | null;
          match_status?: "unmatched" | "matched" | "ignored";
          match_confidence?: number | null;
          suggested_account_id?: string | null;
          reference_number?: string | null;
          raw_data?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          card_account_id?: string;
          transaction_date?: string;
          posted_date?: string | null;
          description?: string;
          amount?: number;
          transaction_type?: "charge" | "refund" | "payment" | "fee" | "interest";
          counterparty?: string | null;
          installment_type?: "lump" | "installment" | "revolving" | "bonus" | null;
          installment_count?: number | null;
          foreign_currency?: string | null;
          foreign_amount?: number | null;
          statement_month?: string | null;
          journal_entry_id?: string | null;
          match_status?: "unmatched" | "matched" | "ignored";
          match_confidence?: number | null;
          suggested_account_id?: string | null;
          reference_number?: string | null;
          raw_data?: Json | null;
        };
        Relationships: [];
      };
      card_payments: {
        Row: {
          id: string;
          card_account_id: string;
          statement_month: string;
          payment_date: string;
          total_amount: number;
          journal_entry_id: string | null;
          bank_transaction_id: string | null;
          status: "scheduled" | "paid" | "cancelled";
          created_at: string;
        };
        Insert: {
          id?: string;
          card_account_id: string;
          statement_month: string;
          payment_date: string;
          total_amount: number;
          journal_entry_id?: string | null;
          bank_transaction_id?: string | null;
          status?: "scheduled" | "paid" | "cancelled";
          created_at?: string;
        };
        Update: {
          id?: string;
          card_account_id?: string;
          statement_month?: string;
          payment_date?: string;
          total_amount?: number;
          journal_entry_id?: string | null;
          bank_transaction_id?: string | null;
          status?: "scheduled" | "paid" | "cancelled";
        };
        Relationships: [];
      };
      raqto_integrations: {
        Row: {
          id: string;
          client_id: string;
          raqto_company_id: string | null;
          raqto_email: string | null;
          raqto_company_name: string | null;
          last_synced_at: string | null;
          is_active: boolean;
          settings: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          raqto_company_id?: string | null;
          raqto_email?: string | null;
          raqto_company_name?: string | null;
          last_synced_at?: string | null;
          is_active?: boolean;
          settings?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          raqto_company_id?: string | null;
          raqto_email?: string | null;
          raqto_company_name?: string | null;
          last_synced_at?: string | null;
          is_active?: boolean;
          settings?: Json | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "raqto_integrations_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: true;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      submission_periods: {
        Row: {
          id: string;
          client_id: string;
          period_start: string;
          period_end: string;
          due_date: string;
          status: "pending" | "submitted" | "overdue" | "completed";
          receipt_count: number;
        };
        Insert: {
          id?: string;
          client_id: string;
          period_start: string;
          period_end: string;
          due_date: string;
          status?: "pending" | "submitted" | "overdue" | "completed";
          receipt_count?: number;
        };
        Update: {
          id?: string;
          client_id?: string;
          period_start?: string;
          period_end?: string;
          due_date?: string;
          status?: "pending" | "submitted" | "overdue" | "completed";
          receipt_count?: number;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          client_id: string;
          table_name: string;
          record_id: string;
          action: "INSERT" | "UPDATE" | "DELETE";
          old_data: Json | null;
          new_data: Json | null;
          performed_by: string | null;
          performed_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          table_name: string;
          record_id: string;
          action: "INSERT" | "UPDATE" | "DELETE";
          old_data?: Json | null;
          new_data?: Json | null;
          performed_by?: string | null;
          performed_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          table_name?: string;
          record_id?: string;
          action?: "INSERT" | "UPDATE" | "DELETE";
          old_data?: Json | null;
          new_data?: Json | null;
          performed_by?: string | null;
          performed_at?: string;
        };
        Relationships: [];
      };
      journal_entries_history: {
        Row: {
          id: string;
          journal_entry_id: string;
          version: number;
          entry_date: string | null;
          description: string | null;
          status: string | null;
          source: string | null;
          receipt_id: string | null;
          metadata: Json | null;
          lines_snapshot: Json;
          changed_by: string | null;
          changed_at: string;
        };
        Insert: {
          id?: string;
          journal_entry_id: string;
          version: number;
          entry_date?: string | null;
          description?: string | null;
          status?: string | null;
          source?: string | null;
          receipt_id?: string | null;
          metadata?: Json | null;
          lines_snapshot: Json;
          changed_by?: string | null;
          changed_at?: string;
        };
        Update: {
          id?: string;
          journal_entry_id?: string;
          version?: number;
          entry_date?: string | null;
          description?: string | null;
          status?: string | null;
          source?: string | null;
          receipt_id?: string | null;
          metadata?: Json | null;
          lines_snapshot?: Json;
          changed_by?: string | null;
          changed_at?: string;
        };
        Relationships: [];
      };
      moneytree_connections: {
        Row: {
          id: string;
          client_id: string;
          access_token: string;
          refresh_token: string | null;
          expires_at: string;
          scope: string | null;
          moneytree_customer_id: string | null;
          is_active: boolean;
          connected_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          access_token: string;
          refresh_token?: string | null;
          expires_at: string;
          scope?: string | null;
          moneytree_customer_id?: string | null;
          is_active?: boolean;
          connected_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          access_token?: string;
          refresh_token?: string | null;
          expires_at?: string;
          scope?: string | null;
          moneytree_customer_id?: string | null;
          is_active?: boolean;
          connected_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moneytree_connections_client_id_fkey";
            columns: ["client_id"];
            referencedRelation: "clients";
            referencedColumns: ["id"];
          }
        ];
      };
    };
    Views: {};
    Functions: {
      is_super_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      get_user_firm_ids: {
        Args: Record<string, never>;
        Returns: string[];
      };
      get_user_client_ids: {
        Args: Record<string, never>;
        Returns: string[];
      };
      setup_self_service_account: {
        Args: {
          p_user_id: string;
          p_name: string;
          p_email: string;
          p_company_name: string;
        };
        Returns: string;
      };
    };
  };
}
