// 初期の部位と種目。ID は固定にして、のちに端末とサーバーで同期するときに同じものとして扱えるようにする。
import type { RecordType } from '@/lib/sets';

export const SEED_BODY_PARTS: { id: string; name: string }[] = [
  { id: '3fbee59a-e853-47b5-a143-3c145c2248d7', name: '胸' },
  { id: 'bf32f045-2308-4099-9a21-c5d683db9b81', name: '背中' },
  { id: 'ec37dcca-4ba3-4121-ac04-60d61a8ef112', name: '肩' },
  { id: '4297851d-7332-40e6-9ad8-8e7c9aee7d2f', name: '脚' },
  { id: 'e5e464f3-ce62-4396-ad40-8e25f464eae8', name: '上腕二頭筋' },
  { id: '8079335d-7d18-4764-9c17-06c91e153d62', name: '上腕三頭筋' },
  { id: 'c9166ad9-9bab-4f2f-9af9-69c145ede18f', name: '腹筋' },
];

const [CHEST, BACK, SHOULDER, LEGS, BICEPS, TRICEPS, ABS] = SEED_BODY_PARTS.map((p) => p.id);
const W: RecordType = 'weight_reps';
const R: RecordType = 'reps_only';

export const SEED_EXERCISES: { id: string; bodyPartId: string; name: string; recordType: RecordType }[] = [
  { id: 'd41c7096-c246-4dfa-945a-e1cb329977a6', bodyPartId: CHEST, name: 'ベンチプレス', recordType: W },
  { id: '62470461-a495-425d-87cd-7751b38993cc', bodyPartId: CHEST, name: 'インクラインダンベルプレス', recordType: W },
  { id: '7a03db74-fc9b-454f-98bd-c36d6cca4dfa', bodyPartId: CHEST, name: 'ダンベルフライ', recordType: W },
  { id: 'aab7de2f-aaf3-43fe-80e7-34eff7375f36', bodyPartId: CHEST, name: 'ケーブルフライ', recordType: W },
  { id: '21a1ef87-cb4b-42ea-81f2-a47fc123d68c', bodyPartId: CHEST, name: '腕立て伏せ', recordType: R },
  { id: '2b2e0dc4-c98d-4656-95f6-e9a21cf03004', bodyPartId: BACK, name: 'デッドリフト', recordType: W },
  { id: '02415e5f-7beb-42b8-9572-2f7b6942a6da', bodyPartId: BACK, name: 'ラットプルダウン', recordType: W },
  { id: '49c20811-a712-4f84-b156-8d4571c465b3', bodyPartId: BACK, name: 'ベントオーバーロウ', recordType: W },
  { id: '0899dd52-5e21-4123-b917-fb2859b67f31', bodyPartId: BACK, name: 'シーテッドロウ', recordType: W },
  { id: '11080b36-79ce-4306-a099-c779ae4323b3', bodyPartId: BACK, name: '懸垂', recordType: R },
  { id: 'fc03a49d-a1f7-478a-b498-1ffaf4f08c5f', bodyPartId: SHOULDER, name: 'ショルダープレス', recordType: W },
  { id: '213988f5-7619-44ec-8d5d-c429aa0150a6', bodyPartId: SHOULDER, name: 'サイドレイズ', recordType: W },
  { id: '8b21c2a0-617d-4117-bb9d-29ec6075e477', bodyPartId: SHOULDER, name: 'リアレイズ', recordType: W },
  { id: 'a902b077-031a-4de6-814b-9ffb69b96778', bodyPartId: LEGS, name: 'スクワット', recordType: W },
  { id: 'de80c2e1-a6bd-479f-81a4-67bf46091634', bodyPartId: LEGS, name: 'レッグプレス', recordType: W },
  { id: 'f4e5b99e-69c9-4e32-b3a8-09a504b9bc12', bodyPartId: LEGS, name: 'ルーマニアンデッドリフト', recordType: W },
  { id: '8cf56999-18b6-4181-8b87-e6ff03e24f4a', bodyPartId: LEGS, name: 'レッグエクステンション', recordType: W },
  { id: '7b7a534d-e5aa-4a05-bc80-5abe5a01a9d9', bodyPartId: LEGS, name: 'レッグカール', recordType: W },
  { id: '03b4fdba-721e-4c90-ad62-4dd44e25b064', bodyPartId: BICEPS, name: 'バーベルカール', recordType: W },
  { id: 'bfea78af-73b3-47a6-a6a2-3a67532f7202', bodyPartId: BICEPS, name: 'ダンベルカール', recordType: W },
  { id: '295306fe-33cf-4994-9e57-59e4510b3816', bodyPartId: BICEPS, name: 'ハンマーカール', recordType: W },
  { id: 'c6660364-90b4-464b-bf47-d8c9d2462e98', bodyPartId: TRICEPS, name: 'トライセプスプレスダウン', recordType: W },
  { id: '735f24df-cfb2-4bf4-94d3-d857db3b0671', bodyPartId: TRICEPS, name: 'ライイングトライセプスエクステンション', recordType: W },
  { id: 'ab83499c-9ce9-4749-ae49-24275c91de93', bodyPartId: TRICEPS, name: 'ディップス', recordType: R },
  { id: '6a258b3f-f7a5-4098-9b17-67d95768cb55', bodyPartId: ABS, name: 'クランチ', recordType: R },
  { id: 'c308d40e-c944-4ee2-a5a0-1a1c946dd532', bodyPartId: ABS, name: 'レッグレイズ', recordType: R },
  { id: 'f0930e1c-8c23-400c-9d59-5a91d52b9f7e', bodyPartId: ABS, name: 'アブローラー', recordType: R },
];
