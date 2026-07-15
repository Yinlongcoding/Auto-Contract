export type StandardContractSection = {
  id: number;
  title: string;
  paragraphs: Array<{ en: string; cn: string }>;
};

export const STANDARD_CONTRACT_SECTIONS: StandardContractSection[] = [
  {
    id: 8,
    title: "8. SHIPPING MARKS / 运输标志",
    paragraphs: [{ en: "N/M", cn: "无" }],
  },
  {
    id: 9,
    title: "9. TERMS OF SHIPMENT / 运输条款",
    paragraphs: [
      {
        en: "The Seller is responsible for ship chartering and space booking for cargo transportation.",
        cn: "卖方负责货物运输的船舶租用和舱位预订。",
      },
    ],
  },
  {
    id: 10,
    title: "10. DOCUMENTS / 文件",
    paragraphs: [
      {
        en: "The Seller shall provide the Buyer with the following relevant documents:",
        cn: "卖方应向买方提供以下相关文件：",
      },
      { en: "10.1 Original commercial invoice in 3 sets.", cn: "10.1 原始商业发票3份。" },
      { en: "10.2 Original packing list in 3 sets.", cn: "10.2 原版装箱单3份。" },
      {
        en: "10.3 Original certificate of analysis issued by the Seller in 1 set.",
        cn: "10.3 卖方出具的原版分析证书1套。",
      },
      { en: "10.4 Ocean Bill of Lading.", cn: "10.4 海运提单。" },
      {
        en: "10.5 Certificate of Origin in 1 original and 1 copy.",
        cn: "10.5 产地证原件1份，副本1份。",
      },
      { en: "10.6 Original marine insurance in 1 set.", cn: "10.6 原版海运保险1套。" },
    ],
  },
  {
    id: 11,
    title: "11. COMMODITY WASTAGE AND GOODS INSPECTION / 商品损耗和货物检验",
    paragraphs: [
      {
        en: "11.1 The quantity of the products shall be based on the Seller's outbound measurement record. The Buyer shall conduct re-inspection and acceptance within 10 working days after receiving the goods, with the Buyer bearing the costs of normal re-inspection. A difference between the re-inspection result and the benchmark quantity within 3‰ is within the reasonable error range, calculated based on the total weight of the goods.",
        cn: "11.1 产品数量应以卖方的出库计量记录为准。买方应在收到货物后的10个工作日内进行复查和验收，正常复查费用由买方承担。复查结果与基准数量之间的差异在3‰以内属于合理误差范围，并按货物总重量计算。",
      },
      {
        en: "11.2 After the goods arrive at the destination port, if the Buyer finds that the quality and/or quantity or weight of the goods do not conform to the Contract, except for matters attributable to the insurance company and/or shipping company, the Buyer may raise an objection to the Seller based on an inspection certificate issued by an inspection agency agreed by both parties. Any objection concerning quality, quantity or weight must be raised within 20 days from arrival at the destination port. The Seller shall reply within 5 days after receiving the objection. The objection must be accompanied by a notarized inspection report issued by a commodity inspection department recognized by both parties. If no objection is raised within that period, the quality, quantity, specifications, appearance and color shall be deemed compliant with the Contract.",
        cn: "11.2 货物抵达目的港后，如买方发现货物质量和/或数量、重量不符合合同，除保险公司和/或航运公司应承担的责任外，买方可依据双方认可的检验机构出具的检验证书向卖方提出异议。质量、数量或重量异议必须在货物抵达目的港之日起20日内提出，卖方应在收到异议后5日内回复。异议必须附有双方认可的商品检验部门出具的公证检验报告。逾期未提出异议的，视为产品质量、数量、规格、外观及颜色符合合同。",
      },
    ],
  },
  {
    id: 12,
    title: "12. SEVERABILITY / 可分割性",
    paragraphs: [
      {
        en: "Should any provision of this Contract be considered invalid or unenforceable by a court of competent jurisdiction, that provision shall be severed from this Contract and the remainder shall not be affected and shall continue in full force and effect.",
        cn: "如本合同任何条款被有管辖权的法院认定为无效或不可执行，该条款应从本合同中分离，本合同其余部分不受影响并继续完全有效。",
      },
    ],
  },
  {
    id: 13,
    title: "13. CONTRACT INTEGRITY / 合同完整性",
    paragraphs: [
      {
        en: "The parties acknowledge that this Contract constitutes part of the entire contract between them and supersedes any previous oral or written contracts or understandings concerning its subject matter.",
        cn: "双方确认本合同构成双方完整合同的一部分，并优先于此前双方就本合同主题达成的任何口头或书面协议及谅解。",
      },
    ],
  },
  {
    id: 14,
    title: "14. FORCE MAJEURE TERMS / 不可抗力条款",
    paragraphs: [
      {
        en: "Neither party shall be deemed in breach or otherwise liable to the other for delay or failure in performing its obligations to the extent caused by circumstances unforeseeable on the date of this Contract and beyond that party's reasonable control, including acts of God, outbreak of hostilities, riot, terrorism, governmental or industrial action, fire, explosion, flood, destruction of premises, war, strikes and lock-outs. The time for performance shall be extended accordingly. The affected party shall notify the other party within fifteen days after the force majeure event.",
        cn: "如因天灾、敌对行动、骚乱、恐怖袭击、政府或劳工行为、火灾、爆炸、水灾、房屋损毁、战争、罢工、封锁或其他在签署合同时无法预见且超出合理控制范围的原因，导致一方无法或延迟履行合同，该方不构成违约，相关履行期限相应顺延。受影响一方应在不可抗力事件发生后十五日内通知另一方。",
      },
    ],
  },
  {
    id: 15,
    title: "15. AMENDMENTS TERMS / 修订条款",
    paragraphs: [
      {
        en: "Any amendment of this Contract shall be made in writing and signed and stamped by the parties.",
        cn: "本合同的任何修改均须以书面形式作出，并由双方签字盖章。",
      },
    ],
  },
  {
    id: 16,
    title: "16. NOTICES / 通知",
    paragraphs: [
      {
        en: "Any notice or other information required or stipulated by this Contract to be given by either party to the other shall be made in writing in English and sent to the recipient at the address set out below, or to another address, facsimile number or person designated by the recipient in accordance with this clause.",
        cn: "本合同要求或规定一方提供给另一方的通知或其他信息，须以英文书面形式发送至下列地址，或发送至接收方依本条款指定的其他地址、传真号码或联系人。",
      },
    ],
  },
  {
    id: 17,
    title: "17. APPLICABLE LAW / 适用法律",
    paragraphs: [
      {
        en: "This Contract is governed by and shall be construed in accordance with the laws of the People's Republic of China. Any rules conflicting with those laws shall not apply.",
        cn: "本合同项下的所有交易受中华人民共和国法律管辖，并应依中华人民共和国法律解释，任何与之冲突的规则均不适用。",
      },
    ],
  },
  {
    id: 18,
    title: "18. ARBITRATION TERMS / 仲裁条款",
    paragraphs: [
      {
        en: "Any divergence, dispute or claim, or the termination or invalidity of this Contract, shall first be settled through amicable negotiation. If negotiation fails, both parties agree to submit the dispute to the Hong Kong International Arbitration Centre for arbitration under its then-effective rules. The award shall be final and binding. During arbitration, the undisputed parts of this Contract shall continue to be performed. Unless otherwise stipulated, the arbitration fee shall be borne by the losing party.",
        cn: "任何与本合同有关的分歧、争端或主张，以及合同终止或失效，应先由双方友好协商解决。协商不成的，双方同意提交香港国际仲裁中心，按照申请仲裁时该中心现行有效的仲裁规则仲裁。仲裁裁决为终局裁决，对双方均有约束力。仲裁期间，合同中无争议部分应继续履行。除非另有约定，仲裁费用由败诉方承担。",
      },
    ],
  },
  {
    id: 20,
    title: "20. SPECIAL CLAUSE / 特殊条款",
    paragraphs: [
      {
        en: "20.1 The Buyer shall ensure that the purchased products are within its business scope. If the products are outside that scope, it shall constitute a breach of contract and the Buyer shall bear the resulting liability and all losses caused to the Seller. For precursor chemical products, the Buyer shall cooperate with the Seller by providing all relevant supporting documents required for the products.",
        cn: "20.1 买方应保证所购产品属于其经营范围。若所购产品不在其经营范围内，则视为违约，买方应承担违约责任及给卖方造成的一切损失。如属于易制毒化学品，买方须配合卖方提供该产品所需的全部相关证明文件。",
      },
      {
        en: "20.2 Unless otherwise stipulated, INCOTERMS 2020 and the Uniform Customs and Practice for Documentary Credits (2007 Revision, ICC Publication No. 600) shall govern the trade terms and documentary credit adopted by the parties. If any international convention or treaty conflicts with this Contract, the terms and conditions of this Contract shall prevail.",
        cn: "20.2 除非双方另有约定，本合同采用的贸易术语和信用证应依《2020年国际贸易术语解释通则》及《跟单信用证统一惯例》（2007年修订，国际商会第600号出版物）解释。任何国际公约或条约与本合同条款冲突时，以本合同条款为准。",
      },
    ],
  },
  {
    id: 21,
    title: "21. LANGUAGE AND EFFECTIVENESS / 合同语言与生效",
    paragraphs: [
      {
        en: "This Contract is made in both Chinese and English. The Chinese version shall prevail in case of any conflict between the two versions.",
        cn: "本合同采用中、英文两种文字书写，两种文本含义发生冲突时，以中文版本为准。",
      },
      {
        en: "This Contract becomes effective on the date it is signed and sealed by both parties. It is made in four original copies, three for the Seller and one for the Buyer.",
        cn: "本合同自双方代表签字并盖章之日起生效。本合同一式四份，卖方持三份，买方持一份；如买方要求持两份，则相应增加合同正本数量。",
      },
    ],
  },
];
