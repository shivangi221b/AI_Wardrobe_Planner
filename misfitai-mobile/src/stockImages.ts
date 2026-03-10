import type { ImageSourcePropType } from 'react-native';

export type StockPieceKey = 'sweater' | 'trousers' | 'coat' | 'loafers';

const stock = {
  sweater: require('../assets/stock/cream-sweater.jpg'),
  trousers: require('../assets/stock/dark-trousers.jpg'),
  coat: require('../assets/stock/beige-coat.jpg'),
  loafers: require('../assets/stock/brown-loafers.jpg'),
};

export const stockPieces: Array<{
  key: StockPieceKey;
  name: string;
  image: ImageSourcePropType;
}> = [
  { key: 'sweater', name: 'Cream sweater', image: stock.sweater },
  { key: 'trousers', name: 'Dark trousers', image: stock.trousers },
  { key: 'coat', name: 'Beige coat', image: stock.coat },
  { key: 'loafers', name: 'Brown loafers', image: stock.loafers },
];

export const outerwearImage = stock.coat;
export const shoesImage = stock.loafers;

export function getImageForGarment(name: string, category: 'top' | 'bottom'): ImageSourcePropType {
  const normalized = name.toLowerCase();

  if (category === 'top') {
    if (
      normalized.includes('shirt') ||
      normalized.includes('sweater') ||
      normalized.includes('top') ||
      normalized.includes('blouse')
    ) {
      return stock.sweater;
    }
    return stock.sweater;
  }

  if (
    normalized.includes('trouser') ||
    normalized.includes('pant') ||
    normalized.includes('jean') ||
    normalized.includes('bottom')
  ) {
    return stock.trousers;
  }

  return stock.trousers;
}
