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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor: string | null
          category: string
          created_at: string
          detail: Json
          id: number
          outcome: string
          target: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          actor?: string | null
          category: string
          created_at?: string
          detail?: Json
          id?: number
          outcome?: string
          target?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          actor?: string | null
          category?: string
          created_at?: string
          detail?: Json
          id?: number
          outcome?: string
          target?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      broker_sources: {
        Row: {
          auth_header: string | null
          auth_style: string
          base_url: string
          created_at: string
          fetch_mode: string
          id: string
          last_status: string | null
          last_synced_at: string | null
          name: string
          resources: Json
          secret_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auth_header?: string | null
          auth_style?: string
          base_url: string
          created_at?: string
          fetch_mode?: string
          id?: string
          last_status?: string | null
          last_synced_at?: string | null
          name: string
          resources?: Json
          secret_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auth_header?: string | null
          auth_style?: string
          base_url?: string
          created_at?: string
          fetch_mode?: string
          id?: string
          last_status?: string | null
          last_synced_at?: string | null
          name?: string
          resources?: Json
          secret_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      case_custody: {
        Row: {
          action: string
          actor: string | null
          content_hash: string | null
          created_at: string
          detail: Json
          evidence_id: string
          id: number
          user_id: string
        }
        Insert: {
          action: string
          actor?: string | null
          content_hash?: string | null
          created_at?: string
          detail?: Json
          evidence_id: string
          id?: number
          user_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          content_hash?: string | null
          created_at?: string
          detail?: Json
          evidence_id?: string
          id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_custody_evidence_id_fkey"
            columns: ["evidence_id"]
            isOneToOne: false
            referencedRelation: "case_evidence"
            referencedColumns: ["id"]
          },
        ]
      }
      case_events: {
        Row: {
          actor: string | null
          body: string
          case_id: string
          created_at: string
          extra: Json
          id: number
          kind: string
          user_id: string
        }
        Insert: {
          actor?: string | null
          body: string
          case_id: string
          created_at?: string
          extra?: Json
          id?: number
          kind?: string
          user_id: string
        }
        Update: {
          actor?: string | null
          body?: string
          case_id?: string
          created_at?: string
          extra?: Json
          id?: number
          kind?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
        ]
      }
      case_evidence: {
        Row: {
          case_id: string
          chunk_id: string | null
          connection_id: string | null
          content_hash: string | null
          created_at: string
          dataset_id: string | null
          document_id: string | null
          evidence_kind: string
          fidelity_tier: string | null
          id: string
          label: string
          payload: Json
          record_ids: number[]
          source: string | null
          user_id: string
          vantage: string | null
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          case_id: string
          chunk_id?: string | null
          connection_id?: string | null
          content_hash?: string | null
          created_at?: string
          dataset_id?: string | null
          document_id?: string | null
          evidence_kind?: string
          fidelity_tier?: string | null
          id?: string
          label: string
          payload?: Json
          record_ids?: number[]
          source?: string | null
          user_id: string
          vantage?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          case_id?: string
          chunk_id?: string | null
          connection_id?: string | null
          content_hash?: string | null
          created_at?: string
          dataset_id?: string | null
          document_id?: string | null
          evidence_kind?: string
          fidelity_tier?: string | null
          id?: string
          label?: string
          payload?: Json
          record_ids?: number[]
          source?: string | null
          user_id?: string
          vantage?: string | null
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_evidence_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_evidence_chunk_id_fkey"
            columns: ["chunk_id"]
            isOneToOne: false
            referencedRelation: "document_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_evidence_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "matrix_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_evidence_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_evidence_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      case_proposals: {
        Row: {
          case_id: string
          change_kind: string
          connection_id: string | null
          created_at: string
          id: string
          proposed_change: Json
          rationale: string
          reviewer_note: string | null
          risk: string
          status: string
          target: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          case_id: string
          change_kind?: string
          connection_id?: string | null
          created_at?: string
          id?: string
          proposed_change?: Json
          rationale: string
          reviewer_note?: string | null
          risk?: string
          status?: string
          target?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          case_id?: string
          change_kind?: string
          connection_id?: string | null
          created_at?: string
          id?: string
          proposed_change?: Json
          rationale?: string
          reviewer_note?: string | null
          risk?: string
          status?: string
          target?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_proposals_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_proposals_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "matrix_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          case_number: number
          closed_at: string | null
          created_at: string
          dataset_id: string | null
          devices: string[]
          id: string
          investigation_id: string | null
          owner: string | null
          severity: string
          sites: string[]
          status: string
          summary: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          case_number?: number
          closed_at?: string | null
          created_at?: string
          dataset_id?: string | null
          devices?: string[]
          id?: string
          investigation_id?: string | null
          owner?: string | null
          severity?: string
          sites?: string[]
          status?: string
          summary?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          case_number?: number
          closed_at?: string | null
          created_at?: string
          dataset_id?: string | null
          devices?: string[]
          id?: string
          investigation_id?: string | null
          owner?: string | null
          severity?: string
          sites?: string[]
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "investigations"
            referencedColumns: ["id"]
          },
        ]
      }
      collector_events: {
        Row: {
          collector_id: string
          created_at: string
          extra: Json
          id: number
          kind: string
          level: string
          message: string
          user_id: string
        }
        Insert: {
          collector_id: string
          created_at?: string
          extra?: Json
          id?: number
          kind: string
          level?: string
          message: string
          user_id: string
        }
        Update: {
          collector_id?: string
          created_at?: string
          extra?: Json
          id?: number
          kind?: string
          level?: string
          message?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collector_events_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["id"]
          },
        ]
      }
      collector_interfaces: {
        Row: {
          addresses: Json
          capture_enabled: boolean
          collector_id: string
          created_at: string
          description: string | null
          id: string
          is_loopback: boolean
          is_up: boolean
          last_seen_at: string
          link_speed_bps: number | null
          mac: string | null
          name: string
          user_id: string
        }
        Insert: {
          addresses?: Json
          capture_enabled?: boolean
          collector_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_loopback?: boolean
          is_up?: boolean
          last_seen_at?: string
          link_speed_bps?: number | null
          mac?: string | null
          name: string
          user_id: string
        }
        Update: {
          addresses?: Json
          capture_enabled?: boolean
          collector_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_loopback?: boolean
          is_up?: boolean
          last_seen_at?: string
          link_speed_bps?: number | null
          mac?: string | null
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collector_interfaces_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["id"]
          },
        ]
      }
      collectors: {
        Row: {
          applied_revision: number
          config: Json
          config_revision: number
          created_at: string
          dataset_id: string | null
          hostname: string | null
          id: string
          last_error: string | null
          last_seen_at: string | null
          name: string
          os: string
          stats: Json
          status: string
          token_hash: string
          updated_at: string
          user_id: string
          version: string | null
        }
        Insert: {
          applied_revision?: number
          config?: Json
          config_revision?: number
          created_at?: string
          dataset_id?: string | null
          hostname?: string | null
          id?: string
          last_error?: string | null
          last_seen_at?: string | null
          name: string
          os?: string
          stats?: Json
          status?: string
          token_hash: string
          updated_at?: string
          user_id: string
          version?: string | null
        }
        Update: {
          applied_revision?: number
          config?: Json
          config_revision?: number
          created_at?: string
          dataset_id?: string | null
          hostname?: string | null
          id?: string
          last_error?: string | null
          last_seen_at?: string | null
          name?: string
          os?: string
          stats?: Json
          status?: string
          token_hash?: string
          updated_at?: string
          user_id?: string
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collectors_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      datasets: {
        Row: {
          chunk_count: number
          created_at: string
          decryption_summary: Json
          id: string
          kind: string
          name: string
          notes: string | null
          observation_point: string | null
          pinned: boolean
          range_end: string | null
          range_start: string | null
          record_count: number
          retention_tier: string
          source_filename: string
          status: string
          user_id: string
          vantage: string
        }
        Insert: {
          chunk_count?: number
          created_at?: string
          decryption_summary?: Json
          id?: string
          kind: string
          name: string
          notes?: string | null
          observation_point?: string | null
          pinned?: boolean
          range_end?: string | null
          range_start?: string | null
          record_count?: number
          retention_tier?: string
          source_filename: string
          status?: string
          user_id: string
          vantage?: string
        }
        Update: {
          chunk_count?: number
          created_at?: string
          decryption_summary?: Json
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          observation_point?: string | null
          pinned?: boolean
          range_end?: string | null
          range_start?: string | null
          record_count?: number
          retention_tier?: string
          source_filename?: string
          status?: string
          user_id?: string
          vantage?: string
        }
        Relationships: []
      }
      device_facts: {
        Row: {
          collected_at: string
          collector_id: string
          content: string
          extra: Json
          host: string
          id: string
          kind: string
          source: string
          summary: string | null
          user_id: string
        }
        Insert: {
          collected_at?: string
          collector_id: string
          content?: string
          extra?: Json
          host: string
          id?: string
          kind?: string
          source?: string
          summary?: string | null
          user_id: string
        }
        Update: {
          collected_at?: string
          collector_id?: string
          content?: string
          extra?: Json
          host?: string
          id?: string
          kind?: string
          source?: string
          summary?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_facts_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["id"]
          },
        ]
      }
      document_chunks: {
        Row: {
          anchor: string | null
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          page: number | null
          section: string | null
          user_id: string
        }
        Insert: {
          anchor?: string | null
          chunk_index: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          page?: number | null
          section?: string | null
          user_id: string
        }
        Update: {
          anchor?: string | null
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          page?: number | null
          section?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          char_count: number
          chunk_count: number
          created_at: string
          doc_class: string
          id: string
          min_role: Database["public"]["Enums"]["app_role"]
          notes: string | null
          product: string | null
          source_filename: string | null
          status: string
          tags: string[]
          title: string
          updated_at: string
          user_id: string
          version: string | null
        }
        Insert: {
          char_count?: number
          chunk_count?: number
          created_at?: string
          doc_class?: string
          id?: string
          min_role?: Database["public"]["Enums"]["app_role"]
          notes?: string | null
          product?: string | null
          source_filename?: string | null
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
          user_id: string
          version?: string | null
        }
        Update: {
          char_count?: number
          chunk_count?: number
          created_at?: string
          doc_class?: string
          id?: string
          min_role?: Database["public"]["Enums"]["app_role"]
          notes?: string | null
          product?: string | null
          source_filename?: string | null
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
          user_id?: string
          version?: string | null
        }
        Relationships: []
      }
      flow_exporters: {
        Row: {
          collector_id: string
          created_at: string
          exporter_ip: string
          flows: number
          id: string
          last_seen_at: string
          packets_dropped: number
          protocol: string
          sampling_rate: number | null
          templates: number
          user_id: string
          version: string | null
        }
        Insert: {
          collector_id: string
          created_at?: string
          exporter_ip: string
          flows?: number
          id?: string
          last_seen_at?: string
          packets_dropped?: number
          protocol?: string
          sampling_rate?: number | null
          templates?: number
          user_id: string
          version?: string | null
        }
        Update: {
          collector_id?: string
          created_at?: string
          exporter_ip?: string
          flows?: number
          id?: string
          last_seen_at?: string
          packets_dropped?: number
          protocol?: string
          sampling_rate?: number | null
          templates?: number
          user_id?: string
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flow_exporters_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_records: {
        Row: {
          app_protocol: string | null
          bytes: number | null
          dataset_id: string
          dst_ip: string | null
          dst_port: number | null
          extra: Json
          flags: string | null
          id: number
          observation_point: string | null
          packets: number | null
          protocol: string | null
          risk_tags: string[]
          service: string | null
          src_ip: string | null
          src_port: number | null
          ts: string | null
          user_id: string
        }
        Insert: {
          app_protocol?: string | null
          bytes?: number | null
          dataset_id: string
          dst_ip?: string | null
          dst_port?: number | null
          extra?: Json
          flags?: string | null
          id?: number
          observation_point?: string | null
          packets?: number | null
          protocol?: string | null
          risk_tags?: string[]
          service?: string | null
          src_ip?: string | null
          src_port?: number | null
          ts?: string | null
          user_id: string
        }
        Update: {
          app_protocol?: string | null
          bytes?: number | null
          dataset_id?: string
          dst_ip?: string | null
          dst_port?: number | null
          extra?: Json
          flags?: string | null
          id?: number
          observation_point?: string | null
          packets?: number | null
          protocol?: string | null
          risk_tags?: string[]
          service?: string | null
          src_ip?: string | null
          src_port?: number | null
          ts?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flow_records_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_rollups: {
        Row: {
          app_protocol: string | null
          bucket_ts: string
          bytes: number
          created_at: string
          dataset_id: string
          dst_ip: string | null
          dst_port: number | null
          flow_count: number
          id: number
          packets: number
          protocol: string | null
          risk_tags: string[]
          rolled_up: boolean
          service: string | null
          src_ip: string | null
          src_port: number | null
          tcp_flag_counts: Json
          user_id: string
          vantage: string | null
        }
        Insert: {
          app_protocol?: string | null
          bucket_ts: string
          bytes?: number
          created_at?: string
          dataset_id: string
          dst_ip?: string | null
          dst_port?: number | null
          flow_count?: number
          id?: number
          packets?: number
          protocol?: string | null
          risk_tags?: string[]
          rolled_up?: boolean
          service?: string | null
          src_ip?: string | null
          src_port?: number | null
          tcp_flag_counts?: Json
          user_id: string
          vantage?: string | null
        }
        Update: {
          app_protocol?: string | null
          bucket_ts?: string
          bytes?: number
          created_at?: string
          dataset_id?: string
          dst_ip?: string | null
          dst_port?: number | null
          flow_count?: number
          id?: number
          packets?: number
          protocol?: string | null
          risk_tags?: string[]
          rolled_up?: boolean
          service?: string | null
          src_ip?: string | null
          src_port?: number | null
          tcp_flag_counts?: Json
          user_id?: string
          vantage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flow_rollups_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      interface_metrics: {
        Row: {
          bucket_ts: string
          collector_id: string
          created_at: string
          discards: number
          errors: number
          id: number
          interface_name: string
          rx_bytes: number
          rx_packets: number
          source: string
          tx_bytes: number
          tx_packets: number
          user_id: string
          utilization_pct: number | null
        }
        Insert: {
          bucket_ts: string
          collector_id: string
          created_at?: string
          discards?: number
          errors?: number
          id?: number
          interface_name: string
          rx_bytes?: number
          rx_packets?: number
          source?: string
          tx_bytes?: number
          tx_packets?: number
          user_id: string
          utilization_pct?: number | null
        }
        Update: {
          bucket_ts?: string
          collector_id?: string
          created_at?: string
          discards?: number
          errors?: number
          id?: number
          interface_name?: string
          rx_bytes?: number
          rx_packets?: number
          source?: string
          tx_bytes?: number
          tx_packets?: number
          user_id?: string
          utilization_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "interface_metrics_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["id"]
          },
        ]
      }
      investigation_messages: {
        Row: {
          created_at: string
          id: string
          investigation_id: string
          message_id: string | null
          parts: Json
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          investigation_id: string
          message_id?: string | null
          parts?: Json
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          investigation_id?: string
          message_id?: string | null
          parts?: Json
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investigation_messages_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "investigations"
            referencedColumns: ["id"]
          },
        ]
      }
      investigations: {
        Row: {
          created_at: string
          dataset_id: string | null
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dataset_id?: string | null
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dataset_id?: string | null
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "investigations_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      live_session_metrics: {
        Row: {
          bucket_ts: string
          bytes: number
          created_at: string
          id: number
          packets: number
          session_id: string
          top: Json
          user_id: string
        }
        Insert: {
          bucket_ts: string
          bytes?: number
          created_at?: string
          id?: number
          packets?: number
          session_id: string
          top?: Json
          user_id: string
        }
        Update: {
          bucket_ts?: string
          bytes?: number
          created_at?: string
          id?: number
          packets?: number
          session_id?: string
          top?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_session_metrics_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "live_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      live_sessions: {
        Row: {
          batch_count: number
          byte_count: number
          capture_filter: string | null
          created_at: string
          dataset_id: string
          expires_at: string
          id: string
          interface_name: string
          last_error: string | null
          last_seen_at: string | null
          observation_point: string | null
          os: string
          packet_count: number
          slice_seconds: number
          status: string
          token_hash: string
          updated_at: string
          user_id: string
          vantage: string
        }
        Insert: {
          batch_count?: number
          byte_count?: number
          capture_filter?: string | null
          created_at?: string
          dataset_id: string
          expires_at?: string
          id?: string
          interface_name: string
          last_error?: string | null
          last_seen_at?: string | null
          observation_point?: string | null
          os?: string
          packet_count?: number
          slice_seconds?: number
          status?: string
          token_hash: string
          updated_at?: string
          user_id: string
          vantage?: string
        }
        Update: {
          batch_count?: number
          byte_count?: number
          capture_filter?: string | null
          created_at?: string
          dataset_id?: string
          expires_at?: string
          id?: string
          interface_name?: string
          last_error?: string | null
          last_seen_at?: string | null
          observation_point?: string | null
          os?: string
          packet_count?: number
          slice_seconds?: number
          status?: string
          token_hash?: string
          updated_at?: string
          user_id?: string
          vantage?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_sessions_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      log_records: {
        Row: {
          dataset_id: string
          extra: Json
          host: string | null
          id: number
          message: string
          severity: string | null
          ts: string | null
          user_id: string
        }
        Insert: {
          dataset_id: string
          extra?: Json
          host?: string | null
          id?: number
          message: string
          severity?: string | null
          ts?: string | null
          user_id: string
        }
        Update: {
          dataset_id?: string
          extra?: Json
          host?: string | null
          id?: number
          message?: string
          severity?: string | null
          ts?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "log_records_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      matrix_alarms: {
        Row: {
          alarm_key: string
          category: string | null
          cleared_at: string | null
          connection_id: string
          device_key: string | null
          extra: Json
          id: string
          message: string
          port_key: string | null
          raised_at: string
          severity: string
          state: string
          user_id: string
        }
        Insert: {
          alarm_key: string
          category?: string | null
          cleared_at?: string | null
          connection_id: string
          device_key?: string | null
          extra?: Json
          id?: string
          message: string
          port_key?: string | null
          raised_at?: string
          severity?: string
          state?: string
          user_id: string
        }
        Update: {
          alarm_key?: string
          category?: string | null
          cleared_at?: string | null
          connection_id?: string
          device_key?: string | null
          extra?: Json
          id?: string
          message?: string
          port_key?: string | null
          raised_at?: string
          severity?: string
          state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matrix_alarms_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "matrix_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      matrix_config_revisions: {
        Row: {
          author: string | null
          captured_at: string
          connection_id: string
          id: string
          revision: number
          snapshot: Json
          summary: string | null
          user_id: string
        }
        Insert: {
          author?: string | null
          captured_at?: string
          connection_id: string
          id?: string
          revision: number
          snapshot?: Json
          summary?: string | null
          user_id: string
        }
        Update: {
          author?: string | null
          captured_at?: string
          connection_id?: string
          id?: string
          revision?: number
          snapshot?: Json
          summary?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matrix_config_revisions_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "matrix_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      matrix_connections: {
        Row: {
          base_url: string | null
          created_at: string
          id: string
          last_error: string | null
          last_polled_at: string | null
          mode: string
          name: string
          poll_interval_seconds: number
          secret_name: string | null
          site: string
          status: string
          updated_at: string
          user_id: string
          verify_tls: boolean
        }
        Insert: {
          base_url?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_polled_at?: string | null
          mode?: string
          name: string
          poll_interval_seconds?: number
          secret_name?: string | null
          site?: string
          status?: string
          updated_at?: string
          user_id: string
          verify_tls?: boolean
        }
        Update: {
          base_url?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          last_polled_at?: string | null
          mode?: string
          name?: string
          poll_interval_seconds?: number
          secret_name?: string | null
          site?: string
          status?: string
          updated_at?: string
          user_id?: string
          verify_tls?: boolean
        }
        Relationships: []
      }
      matrix_devices: {
        Row: {
          connection_id: string
          created_at: string
          device_key: string
          health: Json
          health_status: string
          id: string
          last_seen_at: string
          mgmt_ip: string | null
          model: string | null
          name: string
          os_version: string | null
          p4_state: Json
          role: string
          serial: string | null
          site: string | null
          user_id: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          device_key: string
          health?: Json
          health_status?: string
          id?: string
          last_seen_at?: string
          mgmt_ip?: string | null
          model?: string | null
          name: string
          os_version?: string | null
          p4_state?: Json
          role?: string
          serial?: string | null
          site?: string | null
          user_id: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          device_key?: string
          health?: Json
          health_status?: string
          id?: string
          last_seen_at?: string
          mgmt_ip?: string | null
          model?: string | null
          name?: string
          os_version?: string | null
          p4_state?: Json
          role?: string
          serial?: string | null
          site?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matrix_devices_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "matrix_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      matrix_links: {
        Row: {
          connection_id: string
          created_at: string
          dst_port_id: string | null
          extra: Json
          id: string
          kind: string
          link_key: string
          src_port_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          dst_port_id?: string | null
          extra?: Json
          id?: string
          kind?: string
          link_key: string
          src_port_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          dst_port_id?: string | null
          extra?: Json
          id?: string
          kind?: string
          link_key?: string
          src_port_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matrix_links_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "matrix_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matrix_links_dst_port_id_fkey"
            columns: ["dst_port_id"]
            isOneToOne: false
            referencedRelation: "matrix_ports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matrix_links_src_port_id_fkey"
            columns: ["src_port_id"]
            isOneToOne: false
            referencedRelation: "matrix_ports"
            referencedColumns: ["id"]
          },
        ]
      }
      matrix_policies: {
        Row: {
          actions: Json
          connection_id: string
          device_key: string | null
          egress_ports: string[]
          enabled: boolean
          id: string
          ingress_ports: string[]
          match_rules: Json
          name: string
          policy_key: string
          priority: number
          revision: number
          updated_at: string
          user_id: string
        }
        Insert: {
          actions?: Json
          connection_id: string
          device_key?: string | null
          egress_ports?: string[]
          enabled?: boolean
          id?: string
          ingress_ports?: string[]
          match_rules?: Json
          name: string
          policy_key: string
          priority?: number
          revision?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          actions?: Json
          connection_id?: string
          device_key?: string | null
          egress_ports?: string[]
          enabled?: boolean
          id?: string
          ingress_ports?: string[]
          match_rules?: Json
          name?: string
          policy_key?: string
          priority?: number
          revision?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matrix_policies_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "matrix_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      matrix_port_counters: {
        Row: {
          bucket_ts: string
          connection_id: string
          crc_errors: number
          created_at: string
          discards: number
          errors: number
          id: number
          port_id: string
          rx_bytes: number
          rx_packets: number
          tx_bytes: number
          tx_packets: number
          user_id: string
          utilization_pct: number | null
        }
        Insert: {
          bucket_ts?: string
          connection_id: string
          crc_errors?: number
          created_at?: string
          discards?: number
          errors?: number
          id?: number
          port_id: string
          rx_bytes?: number
          rx_packets?: number
          tx_bytes?: number
          tx_packets?: number
          user_id: string
          utilization_pct?: number | null
        }
        Update: {
          bucket_ts?: string
          connection_id?: string
          crc_errors?: number
          created_at?: string
          discards?: number
          errors?: number
          id?: number
          port_id?: string
          rx_bytes?: number
          rx_packets?: number
          tx_bytes?: number
          tx_packets?: number
          user_id?: string
          utilization_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "matrix_port_counters_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "matrix_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matrix_port_counters_port_id_fkey"
            columns: ["port_id"]
            isOneToOne: false
            referencedRelation: "matrix_ports"
            referencedColumns: ["id"]
          },
        ]
      }
      matrix_ports: {
        Row: {
          admin_state: string
          connection_id: string
          created_at: string
          description: string | null
          device_id: string
          extra: Json
          id: string
          kind: string
          media: string | null
          name: string
          oper_state: string
          port_key: string
          speed_bps: number | null
          user_id: string
        }
        Insert: {
          admin_state?: string
          connection_id: string
          created_at?: string
          description?: string | null
          device_id: string
          extra?: Json
          id?: string
          kind?: string
          media?: string | null
          name: string
          oper_state?: string
          port_key: string
          speed_bps?: number | null
          user_id: string
        }
        Update: {
          admin_state?: string
          connection_id?: string
          created_at?: string
          description?: string | null
          device_id?: string
          extra?: Json
          id?: string
          kind?: string
          media?: string | null
          name?: string
          oper_state?: string
          port_key?: string
          speed_bps?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matrix_ports_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "matrix_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matrix_ports_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "matrix_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      packet_records: {
        Row: {
          app_protocol: string | null
          dataset_id: string
          decryption: string
          dst_ip: string | null
          dst_port: number | null
          extra: Json
          frame_number: number | null
          id: number
          info: string | null
          length: number
          protocol: string | null
          risk_tags: string[]
          service: string | null
          src_ip: string | null
          src_port: number | null
          tcp_flags: string | null
          ts: string | null
          user_id: string
        }
        Insert: {
          app_protocol?: string | null
          dataset_id: string
          decryption?: string
          dst_ip?: string | null
          dst_port?: number | null
          extra?: Json
          frame_number?: number | null
          id?: number
          info?: string | null
          length?: number
          protocol?: string | null
          risk_tags?: string[]
          service?: string | null
          src_ip?: string | null
          src_port?: number | null
          tcp_flags?: string | null
          ts?: string | null
          user_id: string
        }
        Update: {
          app_protocol?: string | null
          dataset_id?: string
          decryption?: string
          dst_ip?: string | null
          dst_port?: number | null
          extra?: Json
          frame_number?: number | null
          id?: number
          info?: string | null
          length?: number
          protocol?: string | null
          risk_tags?: string[]
          service?: string | null
          src_ip?: string | null
          src_port?: number | null
          tcp_flags?: string | null
          ts?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "packet_records_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      probe_results: {
        Row: {
          collector_id: string
          extra: Json
          id: number
          kind: string
          metric: string
          status: string
          target: string
          ts: string
          unit: string | null
          user_id: string
          value: number | null
          value_text: string | null
        }
        Insert: {
          collector_id: string
          extra?: Json
          id?: number
          kind: string
          metric: string
          status?: string
          target: string
          ts?: string
          unit?: string | null
          user_id: string
          value?: number | null
          value_text?: string | null
        }
        Update: {
          collector_id?: string
          extra?: Json
          id?: number
          kind?: string
          metric?: string
          status?: string
          target?: string
          ts?: string
          unit?: string | null
          user_id?: string
          value?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "probe_results_collector_id_fkey"
            columns: ["collector_id"]
            isOneToOne: false
            referencedRelation: "collectors"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          dataset_id: string | null
          id: string
          investigation_id: string | null
          markdown: string
          playbook: string | null
          source: string
          status: string
          title: string
          updated_at: string
          user_id: string
          visuals: Json
        }
        Insert: {
          created_at?: string
          dataset_id?: string | null
          id?: string
          investigation_id?: string | null
          markdown?: string
          playbook?: string | null
          source?: string
          status?: string
          title?: string
          updated_at?: string
          user_id: string
          visuals?: Json
        }
        Update: {
          created_at?: string
          dataset_id?: string | null
          id?: string
          investigation_id?: string | null
          markdown?: string
          playbook?: string | null
          source?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          visuals?: Json
        }
        Relationships: [
          {
            foreignKeyName: "reports_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "investigations"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_runs: {
        Row: {
          chunks_deleted: number
          detail: Json
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: number
          rows_deleted: number
          rows_rolled: number
          started_at: string
          status: string
          summaries_written: number
          user_id: string | null
        }
        Insert: {
          chunks_deleted?: number
          detail?: Json
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: number
          rows_deleted?: number
          rows_rolled?: number
          started_at?: string
          status?: string
          summaries_written?: number
          user_id?: string | null
        }
        Update: {
          chunks_deleted?: number
          detail?: Json
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: number
          rows_deleted?: number
          rows_rolled?: number
          started_at?: string
          status?: string
          summaries_written?: number
          user_id?: string | null
        }
        Relationships: []
      }
      retention_settings: {
        Row: {
          chunk_cap: number
          created_at: string
          enabled: boolean
          metadata_days: number
          raw_hours: number
          summary_days: number
          updated_at: string
          user_id: string
        }
        Insert: {
          chunk_cap?: number
          created_at?: string
          enabled?: boolean
          metadata_days?: number
          raw_hours?: number
          summary_days?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          chunk_cap?: number
          created_at?: string
          enabled?: boolean
          metadata_days?: number
          raw_hours?: number
          summary_days?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      retention_summaries: {
        Row: {
          bytes: number
          created_at: string
          dataset_id: string
          flow_count: number
          hour_ts: string
          id: number
          packets: number
          protocol_mix: Json
          risk_counts: Json
          top_services: Json
          top_talkers: Json
          user_id: string
        }
        Insert: {
          bytes?: number
          created_at?: string
          dataset_id: string
          flow_count?: number
          hour_ts: string
          id?: number
          packets?: number
          protocol_mix?: Json
          risk_counts?: Json
          top_services?: Json
          top_talkers?: Json
          user_id: string
        }
        Update: {
          bytes?: number
          created_at?: string
          dataset_id?: string
          flow_count?: number
          hour_ts?: string
          id?: number
          packets?: number
          protocol_mix?: Json
          risk_counts?: Json
          top_services?: Json
          top_talkers?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_summaries_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      snmp_records: {
        Row: {
          dataset_id: string
          extra: Json
          host: string | null
          id: number
          interface_name: string | null
          metric: string
          oid: string | null
          ts: string | null
          user_id: string
          value: number | null
          value_text: string | null
        }
        Insert: {
          dataset_id: string
          extra?: Json
          host?: string | null
          id?: number
          interface_name?: string | null
          metric: string
          oid?: string | null
          ts?: string | null
          user_id: string
          value?: number | null
          value_text?: string | null
        }
        Update: {
          dataset_id?: string
          extra?: Json
          host?: string | null
          id?: number
          interface_name?: string | null
          metric?: string
          oid?: string | null
          ts?: string | null
          user_id?: string
          value?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "snmp_records_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      telemetry_chunks: {
        Row: {
          content: string
          created_at: string
          dataset_id: string
          embedding: string | null
          id: string
          kind: string
          record_ids: number[]
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          dataset_id: string
          embedding?: string | null
          id?: string
          kind: string
          record_ids?: number[]
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          dataset_id?: string
          embedding?: string | null
          id?: string
          kind?: string
          record_ids?: number[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telemetry_chunks_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
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
      wmi_records: {
        Row: {
          dataset_id: string
          event_id: string | null
          extra: Json
          host: string | null
          id: number
          level: string | null
          message: string
          ts: string | null
          user_id: string
          wmi_class: string | null
        }
        Insert: {
          dataset_id: string
          event_id?: string | null
          extra?: Json
          host?: string | null
          id?: number
          level?: string | null
          message: string
          ts?: string | null
          user_id: string
          wmi_class?: string | null
        }
        Update: {
          dataset_id?: string
          event_id?: string | null
          extra?: Json
          host?: string | null
          id?: number
          level?: string | null
          message?: string
          ts?: string | null
          user_id?: string
          wmi_class?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wmi_records_dataset_id_fkey"
            columns: ["dataset_id"]
            isOneToOne: false
            referencedRelation: "datasets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      history_coverage: {
        Row: {
          dataset_id: string | null
          newest: string | null
          oldest: string | null
          rows_count: number | null
          source: string | null
          tier: string | null
        }
        Relationships: []
      }
      history_flow_timeline: {
        Row: {
          bucket_ts: string | null
          bytes: number | null
          dataset_id: string | null
          flows: number | null
          packets: number | null
          tier: string | null
        }
        Relationships: []
      }
      history_service_mix: {
        Row: {
          app_protocol: string | null
          bytes: number | null
          dataset_id: string | null
          dst_port: number | null
          first_seen: string | null
          flows: number | null
          last_seen: string | null
          packets: number | null
          protocol: string | null
          service: string | null
          tier: string | null
        }
        Relationships: []
      }
      history_top_talkers: {
        Row: {
          bytes: number | null
          dataset_id: string | null
          dst_ip: string | null
          first_seen: string | null
          flows: number | null
          last_seen: string | null
          packets: number | null
          src_ip: string | null
          tier: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      history_query: {
        Args: { p_max_rows?: number; p_sql: string }
        Returns: Json
      }
      match_document_chunks: {
        Args: {
          filter_doc_class?: string
          match_count?: number
          query_embedding: string
        }
        Returns: {
          anchor: string
          chunk_id: string
          content: string
          doc_class: string
          document_id: string
          page: number
          product: string
          section: string
          similarity: number
          title: string
          version: string
        }[]
      }
      match_telemetry_chunks: {
        Args: {
          match_count?: number
          query_embedding: string
          target_dataset: string
        }
        Returns: {
          content: string
          dataset_id: string
          id: string
          kind: string
          record_ids: number[]
          similarity: number
        }[]
      }
      retention_storage_stats: {
        Args: never
        Returns: {
          live_rows: number
          table_name: string
          total_bytes: number
        }[]
      }
      retention_timeline: {
        Args: { p_days?: number }
        Returns: {
          day: string
          rows_count: number
          tier: string
        }[]
      }
      run_retention: {
        Args: { p_user?: string }
        Returns: {
          chunks_deleted: number
          rows_deleted: number
          rows_rolled: number
          summaries_written: number
        }[]
      }
      run_retention_for_me: {
        Args: never
        Returns: {
          chunks_deleted: number
          rows_deleted: number
          rows_rolled: number
          summaries_written: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
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
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
