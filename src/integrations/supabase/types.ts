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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      prediction_learnings: {
        Row: {
          created_at: string
          failure_reason: string | null
          id: string
          lesson_extracted: string
          market_conditions: Json | null
          pattern_context: Json | null
          prediction_id: string | null
          success_factors: string | null
        }
        Insert: {
          created_at?: string
          failure_reason?: string | null
          id?: string
          lesson_extracted: string
          market_conditions?: Json | null
          pattern_context?: Json | null
          prediction_id?: string | null
          success_factors?: string | null
        }
        Update: {
          created_at?: string
          failure_reason?: string | null
          id?: string
          lesson_extracted?: string
          market_conditions?: Json | null
          pattern_context?: Json | null
          prediction_id?: string | null
          success_factors?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prediction_learnings_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      predictions: {
        Row: {
          confidence: number
          created_at: string
          current_price_at_prediction: number
          entry_price: number
          expires_at: string
          id: string
          outcome: string | null
          outcome_at: string | null
          outcome_price: number | null
          patterns_detected: Json | null
          reasoning: string | null
          sentiment_score: number | null
          signal_type: string
          stop_loss: number | null
          take_profit_1: number | null
          take_profit_2: number | null
          technical_indicators: Json | null
          trend_direction: string
          trend_strength: number | null
        }
        Insert: {
          confidence: number
          created_at?: string
          current_price_at_prediction: number
          entry_price: number
          expires_at?: string
          id?: string
          outcome?: string | null
          outcome_at?: string | null
          outcome_price?: number | null
          patterns_detected?: Json | null
          reasoning?: string | null
          sentiment_score?: number | null
          signal_type: string
          stop_loss?: number | null
          take_profit_1?: number | null
          take_profit_2?: number | null
          technical_indicators?: Json | null
          trend_direction: string
          trend_strength?: number | null
        }
        Update: {
          confidence?: number
          created_at?: string
          current_price_at_prediction?: number
          entry_price?: number
          expires_at?: string
          id?: string
          outcome?: string | null
          outcome_at?: string | null
          outcome_price?: number | null
          patterns_detected?: Json | null
          reasoning?: string | null
          sentiment_score?: number | null
          signal_type?: string
          stop_loss?: number | null
          take_profit_1?: number | null
          take_profit_2?: number | null
          technical_indicators?: Json | null
          trend_direction?: string
          trend_strength?: number | null
        }
        Relationships: []
      }
      price_history: {
        Row: {
          close: number
          high: number
          id: string
          low: number
          open: number
          symbol: string
          timeframe: string
          timestamp: string
          volume: number | null
        }
        Insert: {
          close: number
          high: number
          id?: string
          low: number
          open: number
          symbol?: string
          timeframe?: string
          timestamp: string
          volume?: number | null
        }
        Update: {
          close?: number
          high?: number
          id?: string
          low?: number
          open?: number
          symbol?: string
          timeframe?: string
          timestamp?: string
          volume?: number | null
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
