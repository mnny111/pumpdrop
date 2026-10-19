const pokemonArt=id=>`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
const cardArt=id=>`https://images.pokemontcg.io/${id}_hires.png`;
const packs=[
{id:'legendary',name:'Legendary Pokemon Gacha Pack',category:'Pokémon',price:250,tag:'THE GRAIL CHASE',accent:'#e7ba70',glow:'#8b53274d',pack:'#50341d',title:'LEGENDARY',art:pokemonArt(6),description:'Big fire. Bigger pulls. Chase an iconic Pokémon grail.',pool:[['Charizard ex','sv3pt5/199'],['Mewtwo VSTAR','swsh12pt5/GG44'],['Pikachu VMAX','swsh4/188']]},
{id:'celestial',name:'Celestial Pokemon Gacha Pack',category:'Pokémon',price:100,tag:'WRITTEN IN THE STARS',accent:'#c5a5ff',glow:'#7344a84d',pack:'#38284d',title:'CELESTIAL',art:pokemonArt(384),description:'A cosmic lineup with out-of-this-world potential.',pool:[['Umbreon VMAX','swsh7/215'],['Rayquaza VMAX','swsh7/218'],['Mew VMAX','swsh8/269']]},
{id:'starter',name:'Starter Pokemon Gacha Pack',category:'Pokémon',price:25,tag:'START YOUR COLLECTION',accent:'#99d6a0',glow:'#4b92524d',pack:'#224b33',title:'STARTER',art:pokemonArt(25),description:'Your first great pull starts here. A little everyday magic.',pool:[['Pikachu','sv3pt5/173'],['Bulbasaur','sv3pt5/166'],['Squirtle','sv3pt5/170']]},
{id:'emperor',name:'One Piece Emperor Pack',category:'One Piece',price:150,tag:'CLAIM YOUR CROWN',accent:'#f68c75',glow:'#b737294d',pack:'#632c24',title:'EMPEROR',icon:'☠',description:'Set sail for the next addition to your pirate collection.',pool:[['Emperor’s Bounty','☠'],['Captain’s Treasure','⚓'],['Grand Line Legend','⛵']]},
{id:'sports',name:'All Star Sports Gacha Pack 500',category:'Sports',price:500,tag:'HALL OF FAME ENERGY',accent:'#8dc7fa',glow:'#2e6aaf4d',pack:'#233e65',title:'ALL STAR',icon:'🏀',description:'Game-time greatness. A showcase of all-star collectibles.',pool:[['Courtside All Star','🏀'],['Championship Legend','🏆'],['Rookie Spotlight','⚾']]},
{id:'watch',name:'Watch 500',category:'Watches',price:500,tag:'TIMELESS BY DESIGN',accent:'#d5d4b8',glow:'#9b95634d',pack:'#454638',title:'WATCH 500',icon:'⌚',description:'Make time for the finer things. Discover your next grail.',pool:[['Midnight Chronograph','⌚'],['Heritage Diver','⌚'],['Golden Hour Automatic','⌚']]}
];

export {packs};
