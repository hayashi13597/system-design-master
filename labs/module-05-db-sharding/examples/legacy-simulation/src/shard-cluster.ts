export interface UserRecord {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  storedInShard: string;
}

export class ShardInstance {
  public readonly name: string;
  private storage: Map<string, UserRecord> = new Map();

  constructor(name: string) {
    this.name = name;
  }

  async insert(user: UserRecord): Promise<void> {
    // Mô phỏng độ trễ ghi đĩa 5ms
    await new Promise(r => setTimeout(r, 5));
    this.storage.set(user.id, { ...user, storedInShard: this.name });
  }

  async getById(id: string): Promise<UserRecord | null> {
    await new Promise(r => setTimeout(r, 3));
    const u = this.storage.get(id);
    return u ? { ...u } : null;
  }

  async getAll(): Promise<UserRecord[]> {
    await new Promise(r => setTimeout(r, 5));
    return Array.from(this.storage.values());
  }

  getCount(): number {
    return this.storage.size;
  }

  clear() {
    this.storage.clear();
  }
}

export class ShardCluster {
  private shards: Map<string, ShardInstance> = new Map();

  constructor() {
    // Khởi tạo cụm ban đầu với 3 Shard nodes vật lý
    this.addShard('shard-01');
    this.addShard('shard-02');
    this.addShard('shard-03');
  }

  addShard(name: string): ShardInstance {
    const shard = new ShardInstance(name);
    this.shards.set(name, shard);
    return shard;
  }

  getShard(name: string): ShardInstance | undefined {
    return this.shards.get(name);
  }

  getAllShards(): ShardInstance[] {
    return Array.from(this.shards.values());
  }

  getDistributionStats() {
    const totalRows = Array.from(this.shards.values()).reduce((sum, s) => sum + s.getCount(), 0);
    const distribution = Array.from(this.shards.values()).map(s => {
      const count = s.getCount();
      const percentage = totalRows > 0 ? ((count / totalRows) * 100).toFixed(1) + '%' : '0%';
      return {
        shardName: s.name,
        rowCount: count,
        percentage
      };
    });

    return {
      totalShards: this.shards.size,
      totalRows,
      distribution
    };
  }

  clearAll() {
    for (const s of this.shards.values()) {
      s.clear();
    }
  }
}

export const cluster = new ShardCluster();
