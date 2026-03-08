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
      merchant_memory: {
        Row: {
          confidence_weight: number
          created_at: string
          default_note_template: string | null
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
      transactions_uploaded: {
        Row: {
          amount: number | null
          confidence: number | null
          created_at: string
          date: string | null
          description_normalized: string | null
          description_raw: string | null
          duplicate_fingerprint: string | null
          duplicate_of_transaction_id: string | null
          duplicate_status: string
          exclude_from_expense_totals: boolean
          final_category: string | null
          final_method: string | null
          final_notes: string | null
          id: string
          is_transfer: boolean
          match_explanation: string | null
          match_source: string | null
          mode: string
          owner_id: string
          parse_error: string | null
          parse_status: string
          predicted_category: string | null
          predicted_method: string | null
          predicted_notes: string | null
          review_status: string
          source_file_name: string | null
          source_row_json: Json | null
          transfer_type: string | null
          upload_batch_id: string | null
        }
        Insert: {
          amount?: number | null
          confidence?: number | null
          created_at?: string
          date?: string | null
          description_normalized?: string | null
          description_raw?: string | null
          duplicate_fingerprint?: string | null
          duplicate_of_transaction_id?: string | null
          duplicate_status?: string
          exclude_from_expense_totals?: boolean
          final_category?: string | null
          final_method?: string | null
          final_notes?: string | null
          id?: string
          is_transfer?: boolean
          match_explanation?: string | null
          match_source?: string | null
          mode: string
          owner_id: string
          parse_error?: string | null
          parse_status?: string
          predicted_category?: string | null
          predicted_method?: string | null
          predicted_notes?: string | null
          review_status?: string
          source_file_name?: string | null
          source_row_json?: Json | null
          transfer_type?: string | null
          upload_batch_id?: string | null
        }
        Update: {
          amount?: number | null
          confidence?: number | null
          created_at?: string
          date?: string | null
          description_normalized?: string | null
          description_raw?: string | null
          duplicate_fingerprint?: string | null
          duplicate_of_transaction_id?: string | null
          duplicate_status?: string
          exclude_from_expense_totals?: boolean
          final_category?: string | null
          final_method?: string | null
          final_notes?: string | null
          id?: string
          is_transfer?: boolean
          match_explanation?: string | null
          match_source?: string | null
          mode?: string
          owner_id?: string
          parse_error?: string | null
          parse_status?: string
          predicted_category?: string | null
          predicted_method?: string | null
          predicted_notes?: string | null
          review_status?: string
          source_file_name?: string | null
          source_row_json?: Json | null
          transfer_type?: string | null
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
