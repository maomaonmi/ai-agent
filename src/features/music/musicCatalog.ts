// Why: 本期音乐工坊为纯前端静态页（design D3），数据与视图分离，
// 清单为唯一数据源；后续接后端时以真实元数据替换本模块即可。

export type MusicTag = 'featured' | 'remix' | 'accompaniment';

export interface MusicTrack {
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  readonly duration: string;
  readonly cover: string;
  readonly tag: MusicTag;
  readonly plays?: string;
  readonly likes?: string;
}

export const MUSIC_TAG_LABELS: Readonly<Record<MusicTag, string>> = {
  featured: '精选',
  remix: '改编',
  accompaniment: '伴奏',
};

// public/music/cover/ 下真实文件名（去 .jpeg 扩展名），与 test/musicCatalog.test.ts 的目录核对保持同步。
const COVER_IDS: readonly string[] = [
  '1ec45ab1a43b42df915300a8f3868b38~tplv-gcu5kd5gi6-large',
  '21dae3a1ccb64d549b9045254839b962~tplv-gcu5kd5gi6-large',
  '27e579eec0fa4045bd2048759cd1c6fc~tplv-gcu5kd5gi6-large',
  '349739fc3b084d01895d65c5f62d2b71~tplv-gcu5kd5gi6-large',
  '3778d9a477524b879ca6fc173a02993d~tplv-gcu5kd5gi6-large',
  '3d6e6e9d9a624eee8cebee63ccf2cf9d~tplv-gcu5kd5gi6-large',
  '3fd71b7ed90242eaaf25abfc72b3471f~tplv-gcu5kd5gi6-large',
  '42112c35ecd74f8fa15f00139d4fd7a2~tplv-gcu5kd5gi6-large',
  '450e3c11662a4b2e92b5ab76d38846c1~tplv-gcu5kd5gi6-large',
  '4cb71da6e3814d2785e3ea04da0314fe~tplv-gcu5kd5gi6-large',
  '4dda83a9639c436688e3ce8ad18c9bd0~tplv-gcu5kd5gi6-large',
  '4e6ba80dc7c64c82b1d814fe61fba596~tplv-gcu5kd5gi6-large',
  '547e040e32a24fc4b68925e7b0714d40~tplv-gcu5kd5gi6-large',
  '5dac1df4d8c14e3283e327ec2ab936a8~tplv-gcu5kd5gi6-large',
  '601cd4509c774ce9a5318c009509262f~tplv-gcu5kd5gi6-large',
  '6b4998e459b7408f839d8d00ce8bb6e5~tplv-gcu5kd5gi6-large',
  '6da310d9f0d44a81913dddebf0b29375~tplv-gcu5kd5gi6-large',
  '720145adbd054defa8f21ecd2fda9f22~tplv-gcu5kd5gi6-large',
  '7cf2c2dc6a964079992c6be1effdcac1~tplv-gcu5kd5gi6-large',
  '7ed5cd0a987447a388d615f9411b83d2~tplv-gcu5kd5gi6-large',
  '8450dac1300b47699fafeef533b1b2e6~tplv-gcu5kd5gi6-large',
  '85cfb0b57f984d32a37da7d2045fb9d4~tplv-gcu5kd5gi6-large',
  '9aae384b190c4b27be0f39819c66e974~tplv-gcu5kd5gi6-large',
  '9b69108520734289bcf9d4baf55cc9fd~tplv-gcu5kd5gi6-large',
  '9b8bb65566fa45e79065c870c18d5d66~tplv-gcu5kd5gi6-large',
  '9fb1174f89ff4da2b11dae925b0d3a3f~tplv-gcu5kd5gi6-large',
  'a0c76a7de3bd406b96a0979c01ce87a0~tplv-gcu5kd5gi6-large',
  'a6084c8f1e2c4a45836c7c2dd66aaaf6~tplv-gcu5kd5gi6-large',
  'ab6525c0acc249d2a8c07b53a5b31228~tplv-gcu5kd5gi6-large',
  'acaac03b979549cf8f0d4b61938e1ac2~tplv-gcu5kd5gi6-large',
  'ade00d641d7f4587b7c356cae755f83f~tplv-gcu5kd5gi6-large',
  'afadd32e3936420b89f561a51ecba6cb~tplv-gcu5kd5gi6-large',
  'b3ec9d8ea1954cb4894fc5d5afe3719f~tplv-gcu5kd5gi6-large',
  'b87c39dff49846a4be2f4e56c23c9a2d~tplv-gcu5kd5gi6-large',
  'baa4fc87aa314619b19737754809a961~tplv-gcu5kd5gi6-large',
  'c3823a322ab14e69aaa489581868d146~tplv-gcu5kd5gi6-large',
  'ccdade61eac445cb8aa8add0b4ca8672~tplv-gcu5kd5gi6-large',
  'ceb631288c1e4fe6b4317a7e2e6c13f1~tplv-gcu5kd5gi6-large',
  'd1e744f6794d4502ba63bfaa50051bc0~tplv-gcu5kd5gi6-large',
  'd8355e049033418db5d7d4dd53075cc1~tplv-gcu5kd5gi6-large',
  'd8cb468ee0994accb968f260b222d796~tplv-gcu5kd5gi6-large',
  'db4f1d6bdf854717a630c9d82c555909~tplv-gcu5kd5gi6-large',
  'de7ba0565d484817917f946632cbaa16~tplv-gcu5kd5gi6-large',
  'df3f7f5be58547f48c0d5a5f1aa9d9e3~tplv-gcu5kd5gi6-large',
  'e030be9a8c8b468c9965cae00624c3b2~tplv-gcu5kd5gi6-large',
  'eb4e0658b4d64bf68f9d61b79a3493fa~tplv-gcu5kd5gi6-large',
  'edbc126ff6d6496b8d10db7ba533f99a~tplv-gcu5kd5gi6-large',
  'f1ea57ca5c7a4e8680cf316d65750698~tplv-gcu5kd5gi6-large',
  'f63ccd10556e46e6919085872f8538ad~tplv-gcu5kd5gi6-large',
  'fb7fff2286284a5a9892a6dee5e122b1~tplv-gcu5kd5gi6-large',
];

// 占位文案（非真实数据），接后端后由真实元数据替换。
const PLACEHOLDER_TITLES: readonly string[] = [
  '自由自在简简单单', '下一个路口再见', '游', '就到这吧', '晚风告白',
  '山海来信', '城市夜行', '星尘漫游', '夏日回音', '雨停之后',
  '逆光飞行', '把青春写成歌', '橘子海', '雾中列车', '风的形状',
  '纸飞机', '月光便利店', '慢半拍', '银河修理员', '热带季风',
  '巷口早餐店', '云端漫步', '旧磁带', '慢递情书', '周末出逃计划',
];

const PLACEHOLDER_ARTISTS: readonly string[] = [
  'VSA', 'Magic Fox', '静候安然', 'DW', '白瓷微醺', '陆离',
  '一颗糖', '南屿', 'MOMO', '阿澈', '鹿鸣', '半杯冰', '青梧', '拾光者',
];

const TAG_ROTATION: readonly MusicTag[] = ['featured', 'remix', 'accompaniment'];

function placeholderDuration(index: number): string {
  const minutes = 2 + ((index * 7) % 3);
  const seconds = (index * 13) % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function placeholderCount(index: number, salt: number): string {
  return `${3 + ((index * 37 + salt) % 90)}w+`;
}

// Why: 用户确认 50 图全量入清单，按顺序轮转均分三标签（featured 17 / remix 17 / accompaniment 16）。
export const MUSIC_TRACKS: readonly MusicTrack[] = COVER_IDS.map((coverId, index) => ({
  id: coverId,
  title: PLACEHOLDER_TITLES[index % PLACEHOLDER_TITLES.length],
  artist: PLACEHOLDER_ARTISTS[index % PLACEHOLDER_ARTISTS.length],
  duration: placeholderDuration(index),
  cover: `/music/cover/${coverId}.jpeg`,
  tag: TAG_ROTATION[index % TAG_ROTATION.length],
  plays: placeholderCount(index, 5),
  likes: placeholderCount(index, 11),
}));

export function filterTracks(tab: MusicTag, tracks: readonly MusicTrack[] = MUSIC_TRACKS): MusicTrack[] {
  return tracks.filter((track) => track.tag === tab);
}
