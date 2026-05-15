export const TOPICS = [
  {
    id: "multimodal-llm-distillation",
    name: "多模态大语言模型蒸馏",
    queries: [
      "all:multimodal AND all:knowledge+distillation AND all:large+language+model",
      "all:multimodal AND all:model+distillation"
    ]
  },
  {
    id: "diffusion-models",
    name: "扩散模型",
    queries: ["all:diffusion+model AND (cat:cs.CV OR cat:cs.LG OR cat:cs.AI)"]
  },
  {
    id: "test-time-adaptation",
    name: "测试时领域自适应",
    queries: ["all:test-time+adaptation", "all:test-time+domain+adaptation"]
  },
  {
    id: "automated-essay-scoring",
    name: "作文评分",
    queries: ["all:automated+essay+scoring", "all:essay+grading AND all:neural"]
  },
  {
    id: "knowledge-tracing",
    name: "知识追踪",
    queries: [
      "all:knowledge+tracing",
      "all:knowledge+tracing AND (cat:cs.AI OR cat:cs.CY OR cat:cs.LG)"
    ]
  },
  {
    id: "prompt-learning",
    name: "提示学习",
    queries: [
      "all:prompt+learning AND (cat:cs.CL OR cat:cs.CV OR cat:cs.LG)",
      "all:prompt+tuning AND all:vision"
    ]
  },
  {
    id: "industrial-anomaly-detection",
    name: "工业异常检测",
    queries: [
      "all:industrial+anomaly+detection",
      "all:anomaly+detection AND all:manufacturing"
    ]
  },
  {
    id: "adversarial-attacks",
    name: "对抗攻击",
    queries: [
      "all:adversarial+attack AND (cat:cs.CV OR cat:cs.LG OR cat:cs.CR)",
      "all:adversarial+robustness AND all:attack"
    ]
  }
];
