export interface NanoCase {
  readonly id: string;
  readonly name: string;
  readonly author?: string;
  readonly url?: string;
  readonly prompt: string;
  readonly description?: string;
  readonly inputImages: readonly string[];
  readonly outputImages: readonly string[];
  readonly notes?: string;
}

export const nanoCases = [
  {
    "id": "case1",
    "name": "照片变手办",
    "author": "@小熏同学",
    "url": "https://x.com/ylspcm",
    "prompt": "create a 1/7 scale commercialized figure of the character in the illustration, in a realistic style and environment. Place the figure on a computer desk, using a circular transparent acrylic base without any text. On the computer screen, display the ZBrush modeling process of the figure. Next to the computer screen, place a BANDAl-style toy packaging box printed with the original artwork.",
    "description": "需上传一张参考图片作为生成手办的对象",
    "inputImages": [
      "/examples/images/case1/input0.jpg"
    ],
    "outputImages": [
      "/examples/images/case1/output0.png"
    ]
  },
  {
    "id": "case2",
    "name": "根据地图箭头生成地面视角图片",
    "author": "@tokumin",
    "url": "https://x.com/tokumin/status/1960583251460022626",
    "prompt": "画出红色箭头看到的内容",
    "description": "需要上传一张包含红色箭头的google maps图像",
    "inputImages": [
      "/examples/images/case2/input.jpg",
      "/examples/images/case2/input2.jpg",
      "/examples/images/case2/input3.jpg"
    ],
    "outputImages": [
      "/examples/images/case2/output.jpg",
      "/examples/images/case2/output2.jpg",
      "/examples/images/case2/output3.jpg"
    ]
  },
  {
    "id": "case3",
    "name": "真实世界的AR信息化",
    "author": "@bilawalsidhu",
    "url": "https://x.com/bilawalsidhu/status/1960529167742853378",
    "prompt": "你是一个基于位置的AR体验生成器。在这张图像中突出显示[兴趣点]并标注相关信息",
    "description": "需上传一张参考图像",
    "inputImages": [],
    "outputImages": [
      "/examples/images/case3/output.jpg"
    ],
    "notes": "需要在提示词中 [POI] 输入需要标注的兴趣点"
  },
  {
    "id": "case4",
    "name": "分离出3D建筑/制作等距模型",
    "author": "@Zieeett",
    "url": "https://x.com/Zieeett/status/1960420874806247762",
    "prompt": "将图像制作成白天和等距视图[仅限建筑]",
    "description": "需上传一张包含对应物体的图像",
    "inputImages": [
      "/examples/images/case4/input.jpg",
      "/examples/images/case4/input2.jpg"
    ],
    "outputImages": [
      "/examples/images/case4/output.jpg",
      "/examples/images/case4/output2.jpg"
    ],
    "notes": "根据需要修改 [方括号] 内的信息（可以设置为车辆、人物等）"
  },
  {
    "id": "case5",
    "name": "不同时代自己的照片",
    "author": "@AmirMushich",
    "url": "https://x.com/AmirMushich/status/1960810850224091439",
    "prompt": "将角色的风格改为[1970]年代的经典[男性]风格\n\n添加[长卷发]，\n[长胡子]，\n将背景改为标志性的[加州夏季风景]\n\n不要改变角色的面部",
    "description": "需上传一张人物的照片",
    "inputImages": [
      "/examples/images/case5/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case5/output.jpg"
    ],
    "notes": "将 [方括号] 中的文字改为你的时代和细节信息"
  },
  {
    "id": "case6",
    "name": "多参考图像生成",
    "author": "@MrDavids1",
    "url": "https://x.com/MrDavids1/status/1960783672665128970",
    "prompt": "一个模特摆姿势靠在粉色宝马车上。她穿着以下物品，场景背景是浅灰色。绿色外星人是一个钥匙扣，挂在粉色手提包上。模特肩上还有一只粉色鹦鹉。旁边坐着一只戴着粉色项圈和金色耳机的哈巴狗",
    "description": "需上传多个参考图",
    "inputImages": [
      "/examples/images/case6/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case6/output.jpg"
    ],
    "notes": "提示词需要详细描述和包含多个参考对象"
  },
  {
    "id": "case7",
    "name": "自动修图",
    "author": "@op7418",
    "url": "https://x.com/op7418/status/1960528616573558864",
    "prompt": "这张照片很无聊很平淡。增强它！增加对比度，提升色彩，改善光线使其更丰富，你可以裁剪和删除影响构图的细节",
    "description": "需上传一张需要进行修正的图像",
    "inputImages": [
      "/examples/images/case7/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case7/output.jpg"
    ]
  },
  {
    "id": "case8",
    "name": "手绘图控制多角色姿态",
    "author": "@op7418",
    "url": "https://x.com/op7418/status/1960536717242573181",
    "prompt": "让这两个角色使用图3的姿势进行战斗。添加适当的视觉背景和场景互动，生成图像比例为16:9",
    "description": "需上传角色的图像以及手绘草图",
    "inputImages": [
      "/examples/images/case8/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case8/output.jpg"
    ]
  },
  {
    "id": "case9",
    "name": "跨视角图像生成",
    "author": "@op7418",
    "url": "https://x.com/op7418/status/1960896630586310656",
    "prompt": "将照片转换为俯视角度并标记摄影师的位置",
    "description": "需上传一张地面上拍摄的照片",
    "inputImages": [
      "/examples/images/case9/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case9/output.jpg"
    ]
  },
  {
    "id": "case10",
    "name": "定制人物贴纸",
    "author": "@op7418",
    "url": "https://x.com/op7418/status/1960385812132192509",
    "prompt": "将这个人物制作成可爱的贴纸风格",
    "description": "需要上传人物图片",
    "inputImages": [
      "/examples/images/case10/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case10/output.jpg"
    ]
  },
  {
    "id": "case11",
    "name": "动漫转真人Coser",
    "author": "@ZHO_ZHO_ZHO",
    "prompt": "将这个动漫角色转换为真人Coser的样子",
    "inputImages": [
      "/examples/images/case11/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case11/output.jpg"
    ]
  },
  {
    "id": "case12",
    "name": "生成角色设定",
    "author": "@ZHO_ZHO_ZHO",
    "prompt": "为这个角色创建完整的设定图",
    "inputImages": [
      "/examples/images/case12/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case12/output.jpg"
    ]
  },
  {
    "id": "case13",
    "name": "色卡线稿上色",
    "author": "@ZHO_ZHO_ZHO",
    "prompt": "根据提供的色卡为线稿上色",
    "inputImages": [
      "/examples/images/case13/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case13/output.jpg"
    ]
  },
  {
    "id": "case14",
    "name": "文章信息图",
    "author": "@黄建同学",
    "prompt": "将这篇文章内容制作成信息图表",
    "inputImages": [],
    "outputImages": [
      "/examples/images/case14/output.jpg"
    ]
  },
  {
    "id": "case15",
    "name": "更换多种发型",
    "author": "@balconychy",
    "prompt": "为这个人尝试不同的发型",
    "inputImages": [],
    "outputImages": [
      "/examples/images/case15/output.jpg"
    ]
  },
  {
    "id": "case16",
    "name": "模型标注讲解图",
    "author": "@berryxia_ai",
    "prompt": "为这个模型添加标注和讲解说明",
    "inputImages": [],
    "outputImages": [
      "/examples/images/case16/output.jpg"
    ]
  },
  {
    "id": "case17",
    "name": "定制大理石雕塑",
    "author": "@umesh_ai",
    "prompt": "将这个人物制作成大理石雕塑",
    "inputImages": [],
    "outputImages": [
      "/examples/images/case17/output.jpg"
    ]
  },
  {
    "id": "case18",
    "name": "根据食材做菜",
    "author": "@Gdgtify",
    "prompt": "用这些食材制作一道美味的菜肴",
    "inputImages": [
      "/examples/images/case18/input1.jpg",
      "/examples/images/case18/input2.jpg",
      "/examples/images/case18/input3.jpg"
    ],
    "outputImages": [
      "/examples/images/case18/output1.jpg",
      "/examples/images/case18/output2.jpg",
      "/examples/images/case18/output3.jpg"
    ]
  },
  {
    "id": "case19",
    "name": "数学题推理",
    "author": "@Gorden Sun",
    "prompt": "解答这道数学题并显示解题过程",
    "inputImages": [
      "/examples/images/case19/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case19/output.jpg"
    ]
  },
  {
    "id": "case20",
    "name": "旧照片上色",
    "author": "@GeminiApp",
    "prompt": "为这张黑白照片添加自然的色彩",
    "inputImages": [
      "/examples/images/case20/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case20/output.jpg"
    ]
  },
  {
    "id": "case21",
    "name": "图像风格转换",
    "author": "Community",
    "prompt": "将这张图片转换为油画风格",
    "inputImages": [
      "/examples/images/case21/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case21/output.jpg"
    ]
  },
  {
    "id": "case22",
    "name": "产品包装设计",
    "author": "Community",
    "prompt": "为这个产品设计包装",
    "inputImages": [
      "/examples/images/case22/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case22/output.jpg"
    ]
  },
  {
    "id": "case23",
    "name": "建筑渲染",
    "author": "Community",
    "prompt": "将这个建筑草图渲染成真实效果",
    "inputImages": [
      "/examples/images/case23/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case23/output.jpg"
    ]
  },
  {
    "id": "case24",
    "name": "动物拟人化",
    "author": "Community",
    "prompt": "将这个动物拟人化",
    "inputImages": [
      "/examples/images/case24/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case24/output.jpg"
    ]
  },
  {
    "id": "case25",
    "name": "场景重建",
    "author": "Community",
    "prompt": "重建这个场景的完整画面",
    "inputImages": [
      "/examples/images/case25/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case25/output.jpg"
    ]
  },
  {
    "id": "case26",
    "name": "时装设计",
    "author": "Community",
    "prompt": "为这个模特设计时装",
    "inputImages": [
      "/examples/images/case26/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case26/output.jpg"
    ]
  },
  {
    "id": "case27",
    "name": "游戏角色设计",
    "author": "Community",
    "prompt": "设计游戏角色",
    "inputImages": [
      "/examples/images/case27/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case27/output.jpg"
    ]
  },
  {
    "id": "case28",
    "name": "插画创作",
    "author": "Community",
    "prompt": "根据这个素材创作插画",
    "inputImages": [],
    "outputImages": [
      "/examples/images/case28/output.jpg",
      "/examples/images/case28/output1.jpg"
    ]
  },
  {
    "id": "case29",
    "name": "3D模型渲染",
    "author": "Community",
    "prompt": "将这个3D模型进行渲染",
    "inputImages": [
      "/examples/images/case29/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case29/output.jpg"
    ]
  },
  {
    "id": "case30",
    "name": "艺术画作复制",
    "author": "Community",
    "prompt": "模仿这个艺术风格创作新作品",
    "inputImages": [],
    "outputImages": [
      "/examples/images/case30/output.jpg",
      "/examples/images/case30/output1.jpg"
    ]
  },
  {
    "id": "case31",
    "name": "室内设计",
    "author": "Community",
    "prompt": "为这个空间设计室内装修",
    "inputImages": [
      "/examples/images/case31/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case31/output.jpg"
    ]
  },
  {
    "id": "case32",
    "name": "卡通化头像",
    "author": "Community",
    "prompt": "将这个人物卡通化",
    "inputImages": [
      "/examples/images/case32/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case32/output.jpg"
    ]
  },
  {
    "id": "case33",
    "name": "场景合成",
    "author": "Community",
    "prompt": "合成这些元素创造新场景",
    "inputImages": [
      "/examples/images/case33/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case33/output.jpg"
    ]
  },
  {
    "id": "case34",
    "name": "光影效果",
    "author": "Community",
    "prompt": "为这个场景添加戏剧性光影",
    "inputImages": [
      "/examples/images/case34/case.jpg"
    ],
    "outputImages": []
  },
  {
    "id": "case35",
    "name": "纹理映射",
    "author": "Community",
    "prompt": "为这个模型添加纹理",
    "inputImages": [
      "/examples/images/case35/case.jpg"
    ],
    "outputImages": []
  },
  {
    "id": "case36",
    "name": "概念艺术",
    "author": "Community",
    "prompt": "创作概念艺术作品",
    "inputImages": [
      "/examples/images/case36/case.jpg"
    ],
    "outputImages": []
  },
  {
    "id": "case37",
    "name": "角色设计",
    "author": "Community",
    "prompt": "设计独特的角色",
    "inputImages": [
      "/examples/images/case37/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case37/output.jpg"
    ]
  },
  {
    "id": "case38",
    "name": "环境设计",
    "author": "Community",
    "prompt": "设计完整的环境场景",
    "inputImages": [],
    "outputImages": [
      "/examples/images/case38/output.jpg"
    ]
  },
  {
    "id": "case39",
    "name": "色彩调整",
    "author": "Community",
    "prompt": "调整图片的色彩搭配",
    "inputImages": [],
    "outputImages": [
      "/examples/images/case39/output.jpg"
    ]
  },
  {
    "id": "case40",
    "name": "背景替换",
    "author": "Community",
    "prompt": "替换背景环境",
    "inputImages": [
      "/examples/images/case40/case.jpg"
    ],
    "outputImages": []
  },
  {
    "id": "case41",
    "name": "细节增强",
    "author": "Community",
    "prompt": "增强图片细节和质量",
    "inputImages": [
      "/examples/images/case41/case.jpg"
    ],
    "outputImages": []
  },
  {
    "id": "case42",
    "name": "风景画创作",
    "author": "Community",
    "prompt": "创作风景画作品",
    "inputImages": [
      "/examples/images/case42/case.jpg"
    ],
    "outputImages": []
  },
  {
    "id": "case43",
    "name": "人像美化",
    "author": "Community",
    "prompt": "美化人像照片",
    "inputImages": [
      "/examples/images/case43/case.jpg"
    ],
    "outputImages": []
  },
  {
    "id": "case44",
    "name": "抽象艺术",
    "author": "Community",
    "prompt": "创作抽象艺术作品",
    "inputImages": [
      "/examples/images/case44/case.jpg"
    ],
    "outputImages": []
  },
  {
    "id": "case45",
    "name": "动漫风格转换",
    "author": "Community",
    "prompt": "转换为动漫风格",
    "inputImages": [
      "/examples/images/case45/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case45/output.jpg"
    ]
  },
  {
    "id": "case46",
    "name": "商业海报",
    "author": "Community",
    "prompt": "设计商业宣传海报",
    "inputImages": [
      "/examples/images/case46/input.jpg"
    ],
    "outputImages": [
      "/examples/images/case46/output.jpg"
    ]
  },
  {
    "id": "case47",
    "name": "创意合成",
    "author": "Community",
    "prompt": "创意元素合成",
    "inputImages": [],
    "outputImages": [
      "/examples/images/case47/output.jpg"
    ]
  }
] as const satisfies readonly NanoCase[];

export const nanoCaseSourceSha256 = '215b6ebbb9879e19106056b98267a98b275a25f811eb397458ecbaf0d1e88080' as const;
export const nanoCasesDataSha256 = '561958eb97f611b45fe77dfaaa8fa7c6a12fbb8f3a9094ec853e47a5c4252fc0' as const;

export const nanoCaseIds: readonly string[] = nanoCases.map((item) => item.id);

export function getNanoCaseById(id: string): NanoCase | undefined {
  return nanoCases.find((item) => item.id === id);
}

export function isNanoCaseId(id: string): boolean {
  return nanoCaseIds.includes(id);
}
