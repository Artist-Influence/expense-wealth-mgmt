export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      account_balance_snapshots: {
        Row: {
          account_id: string
          as_of_date: string
          balance: number
          created_at: string
          id: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          as_of_date: string
          balance?: number
          created_at?: string
          id?: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          as_of_date?: string
          balance?: number
          created_at?: string
          id?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_balance_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "investment_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      allocation_line_items: {
        Row: {
          allocation_plan_id: string
          amount: number
          executed: boolean
          id: string
          notes: string | null
          owner_id: string
          target_account_id: string | null
        }
        Insert: {
          allocation_plan_id: string
          amount?: number
          executed?: boolean
          id?: string
          notes?: string | null
          owner_id: string
          target_account_id?: string | null
        }
        Update: {
          allocation_plan_id?: string
          amount?: number
          executed?: boolean
          id?: string
          notes?: string | null
          owner_id?: string
          target_account_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "allocation_line_items_allocation_plan_id_fkey"
            columns: ["allocation_plan_id"]
            isOneToOne: false
            referencedRelation: "allocation_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocation_line_items_target_account_id_fkey"
            columns: ["target_account_id"]
            isOneToOne: false
            referencedRelation: "investment_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      allocation_plans: {
        Row: {
          created_at: string
          emergency_fund_amount: number
          free_cash: number
          id: string
          month: string
          notes: string | null
          owner_id: string
          status: string
          tax_reserve_amount: number
          total_expenses: number
          total_income: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          emergency_fund_amount?: number
          free_cash?: number
          id?: string
          month: string
          notes?: string | null
          owner_id: string
          status?: string
          tax_reserve_amount?: number
          total_expenses?: number
          total_income?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          emergency_fund_amount?: number
          free_cash?: number
          id?: string
          month?: string
          notes?: string | null
          owner_id?: string
          status?: string
          tax_reserve_amount?: number
          total_expenses?: number
          total_income?: number
          updated_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          ai_enabled: boolean
          business_auto_threshold: number
          business_suggest_threshold: number
          created_at: string
          exclude_transfers_from_totals: boolean
          flag_possible_duplicates: boolean
          id: string
          owner_id: string
          passcode_enabled: boolean
          passcode_hash: string | null
          personal_auto_threshold: number
          personal_suggest_threshold: number
          prevent_exact_duplicates: boolean
          updated_at: string
        }
        Insert: {
          ai_enabled?: boolean
          business_auto_threshold?: number
          business_suggest_threshold?: number
          created_at?: string
          exclude_transfers_from_totals?: boolean
          flag_possible_duplicates?: boolean
          id?: string
          owner_id: string
          passcode_enabled?: boolean
          passcode_hash?: string | null
          personal_auto_threshold?: number
          personal_suggest_threshold?: number
          prevent_exact_duplicates?: boolean
          updated_at?: string
        }
        Update: {
          ai_enabled?: boolean
          business_auto_threshold?: number
          business_suggest_threshold?: number
          created_at?: string
          exclude_transfers_from_totals?: boolean
          flag_possible_duplicates?: boolean
          id?: string
          owner_id?: string
          passcode_enabled?: boolean
          passcode_hash?: string | null
          personal_auto_threshold?: number
          personal_suggest_threshold?: number
          prevent_exact_duplicates?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      categorization_rules: {
        Row: {
          category_output: string | null
          id: string
          is_active: boolean
          match_type: string
          method_output: string | null
          mode: string
          notes_output: string | null
          owner_id: string
          pattern: string
          priority: number
          rule_name: string
        }
        Insert: {
          category_output?: string | null
          id?: string
          is_active?: boolean
          match_type: string
          method_output?: string | null
          mode: string
          notes_output?: string | null
          owner_id: string
          pattern: string
          priority?: number
          rule_name: string
        }
        Update: {
          category_output?: string | null
          id?: string
          is_active?: boolean
          match_type?: string
          method_output?: string | null
          mode?: string
          notes_output?: string | null
          owner_id?: string
          pattern?: string
          priority?: number
          rule_name?: string
        }
        Relationships: []
      }
      category_options: {
        Row: {
          category_name: string
          id: string
          is_active: boolean
          mode: string
          owner_id: string
          sort_order: number
        }
        Insert: {
          category_name: string
          id?: string
          is_active?: boolean
          mode: string
          owner_id: string
          sort_order?: number
        }
        Update: {
          category_name?: string
          id?: string
          is_active?: boolean
          mode?: string
          owner_id?: string
          sort_order?: number
        }
        Relationships: []
      }
      income_transactions: {
        Row: {
          allocation_month: string | null
          amount: number | null
          created_at: string
          date: string | null
          description_normalized: string | null
          description_raw: string | null
          id: string
          income_type: string
          linked_expense_id: string | null
          linked_reimbursement_group_id: string | null
          mode: string
          notes: string | null
          owner_id: string
          source_account_name: string | null
          source_file_name: string | null
          status: string
          taxable_status: string
          upload_batch_id: string | null
        }
        Insert: {
          allocation_month?: string | null
          amount?: number | null
          created_at?: string
          date?: string | null
          description_normalized?: string | null
          description_raw?: string | null
          id?: string
          income_type?: string
          linked_expense_id?: string | null
          linked_reimbursement_group_id?: string | null
          mode?: string
          notes?: string | null
          owner_id: string
          source_account_name?: string | null
          source_file_name?: string | null
          status?: string
          taxable_status?: string
          upload_batch_id?: string | null
        }
        Update: {
          allocation_month?: string | null
          amount?: number | null
          created_at?: string
          date?: string | null
          description_normalized?: string | null
          description_raw?: string | null
          id?: string
          income_type?: string
          linked_expense_id?: string | null
          linked_reimbursement_group_id?: string | null
          mode?: string
          notes?: string | null
          owner_id?: string
          source_account_name?: string | null
          source_file_name?: string | null
          status?: string
          taxable_status?: string
          upload_batch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "income_transactions_linked_expense_id_fkey"
            columns: ["linked_expense_id"]
            isOneToOne: false
            referencedRelation: "transactions_uploaded"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "income_transactions_linked_reimbursement_group_id_fkey"
            columns: ["linked_reimbursement_group_id"]
            isOneToOne: false
            referencedRelation: "reimbursement_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      investment_accounts: {
        Row: {
          account_name: string
          account_type: string
          auto_track_pattern: string | null
          contribution_target_monthly: number
          contribution_target_yearly: number
          contributions_ytd: number
          created_at: string
          current_balance: number
          id: string
          is_active: boolean
          mode: string
          notes: string | null
          owner_id: string
          platform: string | null
          priority: number
          starting_balance_year: number
          updated_at: string
        }
        Insert: {
          account_name: string
          account_type?: string
          auto_track_pattern?: string | null
          contribution_target_monthly?: number
          contribution_target_yearly?: number
          contributions_ytd?: number
          created_at?: string
          current_balance?: number
          id?: string
          is_active?: boolean
          mode?: string
          notes?: string | null
          owner_id: string
          platform?: string | null
          priority?: number
          starting_balance_year?: number
          updated_at?: string
        }
        Update: {
          account_name?: string
          account_type?: string
          auto_track_pattern?: string | null
          contribution_target_monthly?: number
          contribution_target_yearly?: number
          contributions_ytd?: number
          created_at?: string
          current_balance?: number
          id?: string
          is_active?: boolean
          mode?: string
          notes?: string | null
          owner_id?: string
          platform?: string | null
          priority?: number
          starting_balance_year?: number
          updated_at?: string
        }
        Relationships: []
      }
      merchant_memory: {
        Row: {
          confidence_weight: number
          created_at: string
          default_note_template: string | null
          default_reimbursable: boolean
          default_tax_treatment: string | null
          default_transaction_mode: string | null
          id: string
          last_seen: string
          merchant_key: string
          mode: string
          most_common_category: string | null
          most_common_method: string | null
          owner_id: string
          raw_example: string | null
          times_seen: number
          updated_at: string
        }
        Insert: {
          confidence_weight?: number
          created_at?: string
          default_note_template?: string | null
          default_reimbursable?: boolean
          default_tax_treatment?: string | null
          default_transaction_mode?: string | null
          id?: string
          last_seen?: string
          merchant_key: string
          mode: string
          most_common_category?: string | null
          most_common_method?: string | null
          owner_id: string
          raw_example?: string | null
          times_seen?: number
          updated_at?: string
        }
        Update: {
          confidence_weight?: number
          created_at?: string
          default_note_template?: string | null
          default_reimbursable?: boolean
          default_tax_treatment?: string | null
          default_transaction_mode?: string | null
          id?: string
          last_seen?: string
          merchant_key?: string
          mode?: string
          most_common_category?: string | null
          most_common_method?: string | null
          owner_id?: string
          raw_example?: string | null
          times_seen?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          is_owner: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_owner?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_owner?: boolean
          user_id?: string
        }
        Relationships: []
      }
      reimbursement_groups: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          owner_id: string
          received_date: string | null
          reimbursable_to: string
          report_id: string | null
          status: string
          submitted_date: string | null
          title: string
          total_expected: number
          total_received: number
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          owner_id: string
          received_date?: string | null
          reimbursable_to?: string
          report_id?: string | null
          status?: string
          submitted_date?: string | null
          title: string
          total_expected?: number
          total_received?: number
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          owner_id?: string
          received_date?: string | null
          reimbursable_to?: string
          report_id?: string | null
          status?: string
          submitted_date?: string | null
          title?: string
          total_expected?: number
          total_received?: number
        }
        Relationships: []
      }
      tax_profiles: {
        Row: {
          business_owner_income_enabled: boolean
          city: string
          created_at: string
          custom_effective_tax_rate_optional: number | null
          default_federal_reserve_percent: number
          default_nyc_reserve_percent: number
          default_nys_reserve_percent: number
          estimated_tax_payments_ytd: number
          estimated_w2_withholding_ytd: number
          filing_status: string
          id: string
          notes: string | null
          owner_id: string
          resident_city_tax_enabled: boolean
          self_employment_income_enabled: boolean
          state: string
          updated_at: string
          w2_income_enabled: boolean
        }
        Insert: {
          business_owner_income_enabled?: boolean
          city?: string
          created_at?: string
          custom_effective_tax_rate_optional?: number | null
          default_federal_reserve_percent?: number
          default_nyc_reserve_percent?: number
          default_nys_reserve_percent?: number
          estimated_tax_payments_ytd?: number
          estimated_w2_withholding_ytd?: number
          filing_status?: string
          id?: string
          notes?: string | null
          owner_id: string
          resident_city_tax_enabled?: boolean
          self_employment_income_enabled?: boolean
          state?: string
          updated_at?: string
          w2_income_enabled?: boolean
        }
        Update: {
          business_owner_income_enabled?: boolean
          city?: string
          created_at?: string
          custom_effective_tax_rate_optional?: number | null
          default_federal_reserve_percent?: number
          default_nyc_reserve_percent?: number
          default_nys_reserve_percent?: number
          estimated_tax_payments_ytd?: number
          estimated_w2_withholding_ytd?: number
          filing_status?: string
          id?: string
          notes?: string | null
          owner_id?: string
          resident_city_tax_enabled?: boolean
          self_employment_income_enabled?: boolean
          state?: string
          updated_at?: string
          w2_income_enabled?: boolean
        }
        Relationships: []
      }
      transactions_uploaded: {
        Row: {
          amount: number | null
          business_purpose: string | null
          client_or_project_tag: string | null
          confidence: number | null
          counts_as_tax_deduction: boolean
          counts_toward_true_business_spend: boolean
          counts_toward_true_personal_spend: boolean
          created_at: string
          date: string | null
          description_normalized: string | null
          description_raw: string | null
          duplicate_fingerprint: string | null
          duplicate_of_transaction_id: string | null
          duplicate_status: string
          economic_owner: string
          exclude_from_cash_spend_reporting: boolean
          exclude_from_expense_totals: boolean
          final_category: string | null
          final_method: string | null
          final_notes: string | null
          id: string
          is_non_expense_cash_movement: boolean
          is_reimbursable: boolean
          is_split_parent: boolean
          is_transfer: boolean
          linked_reimbursement_group_id: string | null
          match_explanation: string | null
          match_source: string | null
          mode: string
          owner_id: string
          parent_transaction_id: string | null
          parse_error: string | null
          parse_status: string
          predicted_category: string | null
          predicted_method: string | null
          predicted_notes: string | null
          receipt_attached: boolean
          receipt_required: boolean
          reimbursable_to: string | null
          reimbursement_status: string
          review_status: string
          source_file_name: string | null
          source_row_json: Json | null
          tax_entity: string | null
          tax_treatment: string
          transaction_mode: string
          transfer_type: string | null
          treatment_type: string
          upload_batch_id: string | null
        }
        Insert: {
          amount?: number | null
          business_purpose?: string | null
          client_or_project_tag?: string | null
          confidence?: number | null
          counts_as_tax_deduction?: boolean
          counts_toward_true_business_spend?: boolean
          counts_toward_true_personal_spend?: boolean
          created_at?: string
          date?: string | null
          description_normalized?: string | null
          description_raw?: string | null
          duplicate_fingerprint?: string | null
          duplicate_of_transaction_id?: string | null
          duplicate_status?: string
          economic_owner?: string
          exclude_from_cash_spend_reporting?: boolean
          exclude_from_expense_totals?: boolean
          final_category?: string | null
          final_method?: string | null
          final_notes?: string | null
          id?: string
          is_non_expense_cash_movement?: boolean
          is_reimbursable?: boolean
          is_split_parent?: boolean
          is_transfer?: boolean
          linked_reimbursement_group_id?: string | null
          match_explanation?: string | null
          match_source?: string | null
          mode: string
          owner_id: string
          parent_transaction_id?: string | null
          parse_error?: string | null
          parse_status?: string
          predicted_category?: string | null
          predicted_method?: string | null
          predicted_notes?: string | null
          receipt_attached?: boolean
          receipt_required?: boolean
          reimbursable_to?: string | null
          reimbursement_status?: string
          review_status?: string
          source_file_name?: string | null
          source_row_json?: Json | null
          tax_entity?: string | null
          tax_treatment?: string
          transaction_mode?: string
          transfer_type?: string | null
          treatment_type?: string
          upload_batch_id?: string | null
        }
        Update: {
          amount?: number | null
          business_purpose?: string | null
          client_or_project_tag?: string | null
          confidence?: number | null
          counts_as_tax_deduction?: boolean
          counts_toward_true_business_spend?: boolean
          counts_toward_true_personal_spend?: boolean
          created_at?: string
          date?: string | null
          description_normalized?: string | null
          description_raw?: string | null
          duplicate_fingerprint?: string | null
          duplicate_of_transaction_id?: string | null
          duplicate_status?: string
          economic_owner?: string
          exclude_from_cash_spend_reporting?: boolean
          exclude_from_expense_totals?: boolean
          final_category?: string | null
          final_method?: string | null
          final_notes?: string | null
          id?: string
          is_non_expense_cash_movement?: boolean
          is_reimbursable?: boolean
          is_split_parent?: boolean
          is_transfer?: boolean
          linked_reimbursement_group_id?: string | null
          match_explanation?: string | null
          match_source?: string | null
          mode?: string
          owner_id?: string
          parent_transaction_id?: string | null
          parse_error?: string | null
          parse_status?: string
          predicted_category?: string | null
          predicted_method?: string | null
          predicted_notes?: string | null
          receipt_attached?: boolean
          receipt_required?: boolean
          reimbursable_to?: string | null
          reimbursement_status?: string
          review_status?: string
          source_file_name?: string | null
          source_row_json?: Json | null
          tax_entity?: string | null
          tax_treatment?: string
          transaction_mode?: string
          transfer_type?: string | null
          treatment_type?: string
          upload_batch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_uploaded_duplicate_of_transaction_id_fkey"
            columns: ["duplicate_of_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions_uploaded"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_uploaded_linked_reimbursement_group_id_fkey"
            columns: ["linked_reimbursement_group_id"]
            isOneToOne: false
            referencedRelation: "reimbursement_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_uploaded_parent_transaction_id_fkey"
            columns: ["parent_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions_uploaded"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_uploaded_upload_batch_id_fkey"
            columns: ["upload_batch_id"]
            isOneToOne: false
            referencedRelation: "upload_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      upload_batches: {
        Row: {
          approved_count: number
          auto_categorized_count: number
          detected_headers: Json | null
          exact_duplicates_skipped: number
          file_name: string
          id: string
          mapped_columns: Json | null
          mode: string
          needs_review_count: number
          owner_id: string
          parse_details: Json | null
          parse_errors: number
          possible_duplicates_flagged: number
          suggested_count: number
          total_rows: number
          transfers_detected: number
          uploaded_at: string
        }
        Insert: {
          approved_count?: number
          auto_categorized_count?: number
          detected_headers?: Json | null
          exact_duplicates_skipped?: number
          file_name: string
          id?: string
          mapped_columns?: Json | null
          mode: string
          needs_review_count?: number
          owner_id: string
          parse_details?: Json | null
          parse_errors?: number
          possible_duplicates_flagged?: number
          suggested_count?: number
          total_rows?: number
          transfers_detected?: number
          uploaded_at?: string
        }
        Update: {
          approved_count?: number
          auto_categorized_count?: number
          detected_headers?: Json | null
          exact_duplicates_skipped?: number
          file_name?: string
          id?: string
          mapped_columns?: Json | null
          mode?: string
          needs_review_count?: number
          owner_id?: string
          parse_details?: Json | null
          parse_errors?: number
          possible_duplicates_flagged?: number
          suggested_count?: number
          total_rows?: number
          transfers_detected?: number
          uploaded_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
