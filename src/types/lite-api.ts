export interface LiteWebsocketResponse {
  now: number
  servers: LiteServer[]
}

export interface LiteServer {
  uuid?: string
  id: number
  name: string
  public_note: string
  last_active: string
  country_code: string
  host: LiteServerHost
  state: LiteServerStatus
  display_index?: number
  traffic_limit?: number
  traffic_limit_type?: string
  traffic_reset_day?: number
  expired_at?: string
  expiry_timezone?: string
  // Lite 节点接口剩余价值和原币种；长期/未配置时省略。
  remaining_value?: string
  remaining_value_currency?: string
  // Lite 后端权威在线状态，优先于 last_active 时间差。
  online?: boolean
  // Lite 后端 tags 字段透传，用于读取 <JPY> 等内嵌元标签。
  tags?: string
  // 服务器设置里的带宽，主题开关打开后显示在卡片右下角。
  bandwidth?: string
  // Lite 后端 currency 字段透传，作为最后的兜底。
  currency?: string
}

export interface LiteServerHost {
  platform: string
  platform_version: string
  cpu: string[]
  cpu_cores?: number
  gpu: string[]
  mem_total: number
  disk_total: number
  swap_total: number
  arch: string
  boot_time: number
  version: string
}

export interface LiteServerStatus {
  cpu: number
  mem_used: number
  swap_used: number
  disk_used: number
  net_in_transfer: number
  net_out_transfer: number
  net_in_speed: number
  net_out_speed: number
  uptime: number
  load_1: number
  load_5: number
  load_15: number
  tcp_conn_count: number
  udp_conn_count: number
  process_count: number
  temperatures: temperature[]
  gpu: number[]
}

interface temperature {
  Name: string
  Temperature: number
}

export interface ServerGroupResponse {
  success: boolean
  data: ServerGroup[]
}

export interface ServerGroup {
  group: {
    id: number
    created_at: string
    updated_at: string
    name: string
  }
  servers: number[]
}

export interface MonitorResponse {
  success: boolean
  data: LiteMonitor[]
}

export type ServerMonitorChart = {
  [key: string]: {
    created_at: number
    avg_delay: number | null
    packet_loss?: number
    sample_count?: number
    lost?: boolean
  }[]
}

export interface LiteMonitor {
  monitor_id: number
  monitor_name: string
  server_id: number
  server_name: string
  created_at: number[]
  avg_delay: Array<number | null>
  packet_loss?: number[]
  sample_count?: number[]
  /** Task interval in seconds, when the API reported it. */
  interval?: number | null
  /** Per point: the probe ran but got no reply (packet loss), as opposed to no record at all. */
  lost?: boolean[]
}

type SettingConfig = {
  debug: boolean
  language: string
  site_name: string
  site_desc: string
  user_template: string
  admin_template: string
  custom_code: string
}

export interface SettingResponse {
  success: boolean
  data: {
    config: SettingConfig
    private_site?: boolean
    version: string
  }
}
