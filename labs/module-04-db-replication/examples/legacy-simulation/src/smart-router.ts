import { primaryDb, ReplicaDatabase, UserProfile } from './db-cluster';

export interface ReadResult {
  data: UserProfile | null;
  servedBy: string;
  isStale: boolean;
  expectedVersion: number;
}

// =========================================================================
// 1. NAIVE ROUTER (ĐIỀU HƯỚNG NGÂY THƠ - DỄ BỊ REPLICATION LAG)
// =========================================================================
export class NaiveRouter {
  private replicaIndex: number = 0;

  async write(id: string, updates: Partial<UserProfile>) {
    return await primaryDb.write(id, updates);
  }

  // Luôn luôn chuyển toàn bộ lệnh đọc sang Replica bằng Round Robin
  async read(userId: string, targetId: string, expectedVersion?: number): Promise<ReadResult> {
    const replicas = primaryDb.getReplicas();
    const chosenReplica = replicas[this.replicaIndex % replicas.length];
    this.replicaIndex++;

    const data = await chosenReplica.read(targetId);
    const isStale = expectedVersion !== undefined && data !== null && data.version < expectedVersion;

    return {
      data,
      servedBy: chosenReplica.name,
      isStale,
      expectedVersion: expectedVersion || (data ? data.version : 0)
    };
  }
}

// =========================================================================
// 2. CONSISTENT ROUTER (CHUẨN SENIOR/ARCHITECT - READ-YOUR-OWN-WRITES)
// =========================================================================
export class ConsistentRouter {
  private replicaIndex: number = 0;
  // Lưu lịch sử ghi gần nhất của từng user: UserId -> { lastWriteTime, lastWriteLsn }
  private userWriteHistory: Map<string, { time: number; lsn: number }> = new Map();

  // Thời gian ghim đọc vào Primary sau khi Ghi (Pinning Window)
  private readonly PINNING_WINDOW_MS = 1000; // 1 giây

  async write(userId: string, targetId: string, updates: Partial<UserProfile>) {
    const result = await primaryDb.write(targetId, updates);

    // Ghi nhận thời điểm và LSN của người dùng vừa thực hiện thao tác Ghi
    this.userWriteHistory.set(userId, {
      time: Date.now(),
      lsn: result.lsn
    });

    return result;
  }

  async read(userId: string, targetId: string, expectedVersion?: number): Promise<ReadResult> {
    const userHistory = this.userWriteHistory.get(userId);
    const now = Date.now();

    // CHIẾN LƯỢC 1: TIME-BASED PINNING
    // Nếu người dùng này vừa ghi dữ liệu trong vòng 1000ms qua:
    const isRecentlyWritten = userHistory && (now - userHistory.time < this.PINNING_WINDOW_MS);

    if (isRecentlyWritten) {
      // ĐIỀU HƯỚNG THẲNG VÀO PRIMARY ĐỂ ĐẢM BẢO TÍNH NHẤT QUÁN 100%!
      const data = await primaryDb.read(targetId);
      return {
        data,
        servedBy: 'PRIMARY (Routed via Read-Your-Own-Writes Pinning)',
        isStale: false,
        expectedVersion: expectedVersion || (data ? data.version : 0)
      };
    }

    // CHIẾN LƯỢC 2: NẾU KHÔNG TRONG CỬA SỔ PINNING -> ĐIỀU HƯỚNG SANG REPLICA POOL
    const replicas = primaryDb.getReplicas();
    const chosenReplica = replicas[this.replicaIndex % replicas.length];
    this.replicaIndex++;

    // Kiểm tra LSN của Replica xem đã đuổi kịp LSN của User chưa
    if (userHistory && chosenReplica.appliedLsn < userHistory.lsn) {
      // Replica này đang bị lag! Tự động fallback sang Primary hoặc chọn replica khác
      const dataFromPrimary = await primaryDb.read(targetId);
      return {
        data: dataFromPrimary,
        servedBy: `PRIMARY (Fallback from lagging ${chosenReplica.name})`,
        isStale: false,
        expectedVersion: expectedVersion || (dataFromPrimary ? dataFromPrimary.version : 0)
      };
    }

    // Replica đã đồng bộ kịp thời
    const data = await chosenReplica.read(targetId);
    const isStale = expectedVersion !== undefined && data !== null && data.version < expectedVersion;

    return {
      data,
      servedBy: chosenReplica.name,
      isStale,
      expectedVersion: expectedVersion || (data ? data.version : 0)
    };
  }

  // Đảm bảo toàn bộ câu query trong Transaction đều chạy trên Primary
  async withTransaction<T>(fn: (tx: { read: typeof primaryDb.read; write: typeof primaryDb.write }) => Promise<T>): Promise<T> {
    return await fn({
      read: primaryDb.read.bind(primaryDb),
      write: primaryDb.write.bind(primaryDb)
    });
  }

  reset() {
    this.userWriteHistory.clear();
  }
}

export const naiveRouter = new NaiveRouter();
export const consistentRouter = new ConsistentRouter();
