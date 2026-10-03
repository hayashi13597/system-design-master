export interface UserProfile {
  id: string;
  name: string;
  bio: string;
  version: number;
  updatedAt: number;
}

export class ReplicaDatabase {
  public readonly name: string;
  public replicationLagMs: number;
  public appliedLsn: number = 0;
  private storage: Map<string, UserProfile> = new Map();

  constructor(name: string, defaultLagMs: number = 200) {
    this.name = name;
    this.replicationLagMs = defaultLagMs;
  }

  // Khởi tạo dữ liệu ban đầu
  initData(data: Map<string, UserProfile>, initialLsn: number) {
    this.storage = new Map(JSON.parse(JSON.stringify(Array.from(data.entries()))));
    this.appliedLsn = initialLsn;
  }

  // Nhận bản tin sao chép từ Primary bất đồng bộ sau replicationLagMs
  receiveReplication(profile: UserProfile, lsn: number) {
    setTimeout(() => {
      this.storage.set(profile.id, { ...profile });
      this.appliedLsn = lsn;
    }, this.replicationLagMs);
  }

  // Chỉ hỗ trợ đọc (Read-Only)
  async read(id: string): Promise<UserProfile | null> {
    // Mô phỏng độ trễ đọc 5ms
    await new Promise(r => setTimeout(r, 5));
    const item = this.storage.get(id);
    return item ? { ...item } : null;
  }
}

export class PrimaryDatabase {
  public currentLsn: number = 100;
  private storage: Map<string, UserProfile> = new Map();
  private replicas: ReplicaDatabase[] = [];

  constructor() {
    // Khởi tạo user mẫu
    const initialUser: UserProfile = {
      id: 'user_1',
      name: 'Nguyen Van A',
      bio: 'Bio ban đầu lúc khởi tạo hệ thống.',
      version: 1,
      updatedAt: Date.now()
    };
    this.storage.set('user_1', initialUser);
  }

  registerReplica(replica: ReplicaDatabase) {
    replica.initData(this.storage, this.currentLsn);
    this.replicas.push(replica);
  }

  getReplicas(): ReplicaDatabase[] {
    return this.replicas;
  }

  // Thực hiện ghi dữ liệu (INSERT / UPDATE)
  async write(id: string, updates: Partial<UserProfile>): Promise<{ profile: UserProfile; lsn: number }> {
    // Mô phỏng độ trễ ghi WAL đĩa cục bộ 15ms
    await new Promise(r => setTimeout(r, 15));

    this.currentLsn++;
    const current = this.storage.get(id) || {
      id,
      name: updates.name || 'Anonymous',
      bio: '',
      version: 0,
      updatedAt: 0
    };

    const newProfile: UserProfile = {
      ...current,
      ...updates,
      version: current.version + 1,
      updatedAt: Date.now()
    };

    this.storage.set(id, newProfile);

    // Phát bản tin WAL bất đồng bộ sang tất cả Replicas (Asynchronous Replication)
    for (const replica of this.replicas) {
      replica.receiveReplication(newProfile, this.currentLsn);
    }

    return { profile: newProfile, lsn: this.currentLsn };
  }

  // Đọc trực tiếp từ Primary (Fresh Data 100%)
  async read(id: string): Promise<UserProfile | null> {
    await new Promise(r => setTimeout(r, 5));
    const item = this.storage.get(id);
    return item ? { ...item } : null;
  }
}

// Khởi tạo Cluster: 1 Primary + 2 Replicas với độ trễ replication khác nhau
export const primaryDb = new PrimaryDatabase();

// Replica 1: nhanh (lag 50ms)
export const replica1 = new ReplicaDatabase('Replica-1 (Fast)', 50);

// Replica 2: chậm hơn (lag 400ms - mô phỏng mạng xa hoặc đang chịu tải đọc lớn)
export const replica2 = new ReplicaDatabase('Replica-2 (Slow/Busy)', 400);

primaryDb.registerReplica(replica1);
primaryDb.registerReplica(replica2);
