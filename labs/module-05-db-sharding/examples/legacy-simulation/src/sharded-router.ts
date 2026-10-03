import { snowflake } from './snowflake';
import { ConsistentHashRing } from './consistent-hash';
import { cluster, UserRecord } from './shard-cluster';

export class ShardedRouter {
  public ring: ConsistentHashRing;

  constructor() {
    this.ring = new ConsistentHashRing(50); // 50 vnodes per shard
    // Đăng ký các shard hiện có vào vòng tròn hash ring
    for (const shard of cluster.getAllShards()) {
      this.ring.addNode(shard.name);
    }
  }

  // 1. Thao tác Ghi: Sinh Snowflake ID -> Tìm Shard đích -> Ghi vào 1 Shard duy nhất
  async createUser(name: string, email: string): Promise<{ user: UserRecord; targetShard: string; parsedId: any }> {
    const id = snowflake.nextId();
    const targetShardName = this.ring.getNode(id);
    const targetShard = cluster.getShard(targetShardName);

    if (!targetShard) {
      throw new Error(`Không tìm thấy shard: ${targetShardName}`);
    }

    const user: UserRecord = {
      id,
      name,
      email,
      createdAt: new Date().toISOString(),
      storedInShard: targetShardName
    };

    await targetShard.insert(user);

    return {
      user,
      targetShard: targetShardName,
      parsedId: snowflake.parseId(id)
    };
  }

  // 2. Thao tác Đọc theo Khóa chính (Point Query): Định tuyến O(1) thẳng vào Shard đích!
  async getUserById(id: string): Promise<{ user: UserRecord | null; queriedShard: string }> {
    const targetShardName = this.ring.getNode(id);
    const targetShard = cluster.getShard(targetShardName);

    if (!targetShard) {
      throw new Error(`Không tìm thấy shard: ${targetShardName}`);
    }

    const user = await targetShard.getById(id);
    return {
      user,
      queriedShard: targetShardName
    };
  }

  // 3. Thao tác Đọc không có Shard Key: SCATTER-GATHER PATTERN
  // Bắn query song song tới TẤT CẢ các Shards rồi gom kết quả lại
  async getAllUsers(): Promise<{ users: UserRecord[]; totalShardsQueried: number }> {
    const shards = cluster.getAllShards();

    // Scatter: Gửi truy vấn đồng thời tới mọi shards
    const shardPromises = shards.map(s => s.getAll());
    const resultsByShard = await Promise.all(shardPromises);

    // Gather: Gom nhóm và sắp xếp kết quả
    const allUsers = resultsByShard.flat();

    return {
      users: allUsers,
      totalShardsQueried: shards.length
    };
  }

  // Mở rộng động thêm Shard mới vào cụm
  addNewShard(shardName: string) {
    cluster.addShard(shardName);
    this.ring.addNode(shardName);
  }
}

export const shardedRouter = new ShardedRouter();
