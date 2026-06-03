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
          deleted_at: string | null
          id: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          as_of_date: string
          balance?: number
          created_at?: string
          deleted_at?: string | null
          id?: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          as_of_date?: string
          balance?: number
          created_at?: string
          deleted_at?: string | null
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
      ai_usage_events: {
        Row: {
          created_at: string
          fn: string
          id: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          fn: string
          id?: string
          owner_id: string
        }
        Update: {
          created_at?: string
          fn?: string
          id?: string
          owner_id?: string
        }
        Relationships: []
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
          deleted_at: string | null
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
          deleted_at?: string | null
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
          deleted_at?: string | null
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
          last_health_check_at: string | null
          last_health_check_summary: Json | null
          min_business_cash_buffer: number
          min_personal_cash_buffer: number
          monthly_business_expense_target: number
          monthly_personal_spend_limit: number
          monthly_savings_goal: number
          onboarding_completed: boolean
          owner_id: string
          passcode_enabled: boolean
          personal_auto_threshold: number
          personal_suggest_threshold: number
          prevent_exact_duplicates: boolean
          report_basis: string
          report_excluded_categories: string[]
          tax_reserve_percent: number
          updated_at: string
          usage_profile: string
          wealth_target_amount: number
          wealth_target_year: number
        }
        Insert: {
          ai_enabled?: boolean
          business_auto_threshold?: number
          business_suggest_threshold?: number
          created_at?: string
          exclude_transfers_from_totals?: boolean
          flag_possible_duplicates?: boolean
          id?: string
          last_health_check_at?: string | null
          last_health_check_summary?: Json | null
          min_business_cash_buffer?: number
          min_personal_cash_buffer?: number
          monthly_business_expense_target?: number
          monthly_personal_spend_limit?: number
          monthly_savings_goal?: number
          onboarding_completed?: boolean
          owner_id: string
          passcode_enabled?: boolean
          personal_auto_threshold?: number
          personal_suggest_threshold?: number
          prevent_exact_duplicates?: boolean
          report_basis?: string
          report_excluded_categories?: string[]
          tax_reserve_percent?: number
          updated_at?: string
          usage_profile?: string
          wealth_target_amount?: number
          wealth_target_year?: number
        }
        Update: {
          ai_enabled?: boolean
          business_auto_threshold?: number
          business_suggest_threshold?: number
          created_at?: string
          exclude_transfers_from_totals?: boolean
          flag_possible_duplicates?: boolean
          id?: string
          last_health_check_at?: string | null
          last_health_check_summary?: Json | null
          min_business_cash_buffer?: number
          min_personal_cash_buffer?: number
          monthly_business_expense_target?: number
          monthly_personal_spend_limit?: number
          monthly_savings_goal?: number
          onboarding_completed?: boolean
          owner_id?: string
          passcode_enabled?: boolean
          personal_auto_threshold?: number
          personal_suggest_threshold?: number
          prevent_exact_duplicates?: boolean
          report_basis?: string
          report_excluded_categories?: string[]
          tax_reserve_percent?: number
          updated_at?: string
          usage_profile?: string
          wealth_target_amount?: number
          wealth_target_year?: number
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          actor_id: string | null
          created_at: string
          entity: string | null
          entity_id: string | null
          event_type: string
          id: string
          owner_id: string
          summary: Json | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          event_type: string
          id?: string
          owner_id: string
          summary?: Json | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          entity?: string | null
          entity_id?: string | null
          event_type?: string
          id?: string
          owner_id?: string
          summary?: Json | null
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
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          owner_id: string
          parts: Json | null
          role: string
          thread_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          id?: string
          owner_id: string
          parts?: Json | null
          role: string
          thread_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          owner_id?: string
          parts?: Json | null
          role?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "chat_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_threads: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      delegated_access: {
        Row: {
          created_at: string
          grantee_user_id: string
          id: string
          owner_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          grantee_user_id: string
          id?: string
          owner_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          grantee_user_id?: string
          id?: string
          owner_id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      income_transactions: {
        Row: {
          allocation_month: string | null
          amount: number | null
          created_at: string
          date: string | null
          deleted_at: string | null
          description_normalized: string | null
          description_raw: string | null
          duplicate_of_income_id: string | null
          duplicate_status: string
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
          deleted_at?: string | null
          description_normalized?: string | null
          description_raw?: string | null
          duplicate_of_income_id?: string | null
          duplicate_status?: string
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
          deleted_at?: string | null
          description_normalized?: string | null
          description_raw?: string | null
          duplicate_of_income_id?: string | null
          duplicate_status?: string
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
          deleted_at: string | null
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
          deleted_at?: string | null
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
          deleted_at?: string | null
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
      invite_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          label: string | null
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
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
      owner_secrets: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          passcode_hash: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          passcode_hash?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          passcode_hash?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          account_type: string
          created_at: string
          id: string
          is_active: boolean
          match_pattern: string | null
          mode: string
          name: string
          owner_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          account_type?: string
          created_at?: string
          id?: string
          is_active?: boolean
          match_pattern?: string | null
          mode?: string
          name: string
          owner_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          account_type?: string
          created_at?: string
          id?: string
          is_active?: boolean
          match_pattern?: string | null
          mode?: string
          name?: string
          owner_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          is_owner: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          is_owner?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
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
          deleted_at: string | null
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
          deleted_at?: string | null
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
          deleted_at?: string | null
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
          deleted_at: string | null
          description_normalized: string | null
          description_raw: string | null
          direction: string | null
          duplicate_fingerprint: string | null
          duplicate_of_transaction_id: string | null
          duplicate_status: string
          economic_owner: string
          exclude_from_cash_spend_reporting: boolean
          exclude_from_expense_totals: boolean
          expected_next_date: string | null
          final_category: string | null
          final_method: string | null
          final_notes: string | null
          id: string
          is_internal_transfer: boolean
          is_non_expense_cash_movement: boolean
          is_reimbursable: boolean
          is_split_parent: boolean
          is_transfer: boolean
          linked_reimbursement_group_id: string | null
          linked_transaction_id: string | null
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
          receipt_path: string | null
          receipt_required: boolean
          recurrence_frequency: string | null
          recurring_group_id: string | null
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
          deleted_at?: string | null
          description_normalized?: string | null
          description_raw?: string | null
          direction?: string | null
          duplicate_fingerprint?: string | null
          duplicate_of_transaction_id?: string | null
          duplicate_status?: string
          economic_owner?: string
          exclude_from_cash_spend_reporting?: boolean
          exclude_from_expense_totals?: boolean
          expected_next_date?: string | null
          final_category?: string | null
          final_method?: string | null
          final_notes?: string | null
          id?: string
          is_internal_transfer?: boolean
          is_non_expense_cash_movement?: boolean
          is_reimbursable?: boolean
          is_split_parent?: boolean
          is_transfer?: boolean
          linked_reimbursement_group_id?: string | null
          linked_transaction_id?: string | null
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
          receipt_path?: string | null
          receipt_required?: boolean
          recurrence_frequency?: string | null
          recurring_group_id?: string | null
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
          deleted_at?: string | null
          description_normalized?: string | null
          description_raw?: string | null
          direction?: string | null
          duplicate_fingerprint?: string | null
          duplicate_of_transaction_id?: string | null
          duplicate_status?: string
          economic_owner?: string
          exclude_from_cash_spend_reporting?: boolean
          exclude_from_expense_totals?: boolean
          expected_next_date?: string | null
          final_category?: string | null
          final_method?: string | null
          final_notes?: string | null
          id?: string
          is_internal_transfer?: boolean
          is_non_expense_cash_movement?: boolean
          is_reimbursable?: boolean
          is_split_parent?: boolean
          is_transfer?: boolean
          linked_reimbursement_group_id?: string | null
          linked_transaction_id?: string | null
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
          receipt_path?: string | null
          receipt_required?: boolean
          recurrence_frequency?: string | null
          recurring_group_id?: string | null
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
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_ai_rate_limit: {
        Args: { _fn: string; _max: number; _window_seconds: number }
        Returns: boolean
      }
      has_delegated_access: {
        Args: {
          _grantee: string
          _owner: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      log_event: {
        Args: {
          _entity?: string
          _entity_id?: string
          _event_type: string
          _owner: string
          _summary?: Json
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "owner" | "investor" | "accountant"
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
    Enums: {
      app_role: ["owner", "investor", "accountant"],
    },
  },
} as const
